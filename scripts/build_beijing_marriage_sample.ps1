param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectRoot "apps\web\public\samples\beijing-marriage"
$episodePattern = '\u7b2c(\d+)\u96c6'
$titlePattern = '\u7b2c\d+\u96c6\u300a([^\u300b]+)\u300b'
$episodes = @()

foreach ($directory in Get-ChildItem -LiteralPath $SourceRoot -Directory) {
  foreach ($file in Get-ChildItem -LiteralPath $directory.FullName -File -Filter "*.md") {
    $content = (Get-Content -LiteralPath $file.FullName -Encoding utf8 -Raw).Trim()
    $numberMatch = [regex]::Match($content, $episodePattern)
    if (-not $numberMatch.Success) { continue }
    $titleMatch = [regex]::Match($content, $titlePattern)
    $episodes += [pscustomobject][ordered]@{
      episodeNo = [int]$numberMatch.Groups[1].Value
      title = if ($titleMatch.Success) { $titleMatch.Groups[1].Value } else { "Episode $($numberMatch.Groups[1].Value)" }
      content = $content
    }
  }
}

$episodes = @($episodes | Sort-Object episodeNo -Unique)
if ($episodes.Count -ne 12) { throw "Expected 12 episode scripts, found $($episodes.Count)." }
for ($index = 0; $index -lt $episodes.Count; $index++) {
  if ($episodes[$index].episodeNo -ne $index + 1) { throw "Episode numbers must be continuous." }
}

$sampleTitle = -join @([char]0x5317, [char]0x5883, [char]0x5A5A, [char]0x4E66)
$manifest = [ordered]@{
  version = 1
  title = $sampleTitle
  sourceType = "script"
  description = "12 chapter novel adapted into a 12 episode production sample"
  episodes = $episodes
  assets = [ordered]@{ characters = 6; scenes = 18; props = 10; storyboards = 12; seedancePrompts = 12 }
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputDir "manifest.json") -Encoding utf8
Write-Host "SAMPLE_OK $($episodes.Count) episodes"
