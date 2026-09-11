param([string]$RedisImage = 'redis:7-alpine')
$ErrorActionPreference = 'Stop'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 12)
$fixture = "manjiao-aof-test-$suffix"
$first = "$fixture-before"
$second = "$fixture-after"
$volume = "$fixture-data"
$created = @()
$volumeCreated = $false

function Invoke-FixtureDocker {
    param([string[]]$Arguments)
    $result = & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Fixture Docker command failed: $($Arguments[0])" }
    return $result
}

function Wait-FixtureRedis {
    param([string]$Container, [switch]$Aof)
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        $lines = & docker exec $Container redis-cli --raw INFO persistence 2>$null
        if ($LASTEXITCODE -eq 0) {
            $state = @{}
            foreach ($line in $lines) {
                if ($line -match '^([^:#]+):(.+)$') { $state[$Matches[1]] = $Matches[2].Trim() }
            }
            if ($state.loading -eq '0' -and (!$Aof -or (
                $state.aof_enabled -eq '1' -and $state.aof_rewrite_in_progress -eq '0' -and
                $state.aof_rewrite_scheduled -eq '0' -and $state.aof_last_bgrewrite_status -eq 'ok' -and
                $state.aof_last_write_status -eq 'ok'))) { return }
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Isolated Redis fixture did not become ready: $Container"
}

try {
    Invoke-FixtureDocker -Arguments @('volume', 'create', $volume) | Out-Null
    $volumeCreated = $true
    Invoke-FixtureDocker -Arguments @('run', '-d', '--name', $first, '--network', 'none', '--mount', "type=volume,source=$volume,target=/data", $RedisImage, 'redis-server', '--save', '3600 1', '--appendonly', 'no') | Out-Null
    $created += $first
    Wait-FixtureRedis $first
    Invoke-FixtureDocker -Arguments @('exec', $first, 'redis-cli', 'LPUSH', 'fixture:queue', 'task-a', 'task-b') | Out-Null
    Invoke-FixtureDocker -Arguments @('exec', $first, 'redis-cli', 'SET', 'fixture:inflight', 'task-c') | Out-Null
    # Demonstrate that these queue values do not already have an RDB snapshot.
    Invoke-FixtureDocker -Arguments @('exec', $first, 'sh', '-c', 'test ! -e /data/dump.rdb') | Out-Null
    foreach ($setting in @(@('appendfsync', 'everysec'), @('maxmemory-policy', 'noeviction'), @('appendonly', 'yes'))) {
        $reply = Invoke-FixtureDocker -Arguments @('exec', $first, 'redis-cli', '--raw', 'CONFIG', 'SET', $setting[0], $setting[1])
        if ($reply -ne 'OK') { throw "Redis refused fixture configuration: $($setting[0])" }
    }
    Wait-FixtureRedis $first -Aof
    Invoke-FixtureDocker -Arguments @('stop', '--time', '60', $first) | Out-Null
    Invoke-FixtureDocker -Arguments @('run', '-d', '--name', $second, '--network', 'none', '--mount', "type=volume,source=$volume,target=/data", $RedisImage, 'redis-server', '--appendonly', 'yes', '--appendfsync', 'everysec', '--maxmemory-policy', 'noeviction') | Out-Null
    $created += $second
    Wait-FixtureRedis $second -Aof
    $queue = @(Invoke-FixtureDocker -Arguments @('exec', $second, 'redis-cli', '--raw', 'LRANGE', 'fixture:queue', '0', '-1'))
    $inflight = Invoke-FixtureDocker -Arguments @('exec', $second, 'redis-cli', '--raw', 'GET', 'fixture:inflight')
    if (($queue -join ',') -ne 'task-b,task-a' -or $inflight -ne 'task-c') { throw 'Queue or inflight state did not survive AOF migration' }
    Write-Host 'REDIS_AOF_SMOKE_OK: unsnapshotted queue order and inflight state survived container replacement on an isolated volume'
}
finally {
    foreach ($container in $created) { & docker rm -f $container | Out-Null }
    if ($volumeCreated) { & docker volume rm $volume | Out-Null }
}
