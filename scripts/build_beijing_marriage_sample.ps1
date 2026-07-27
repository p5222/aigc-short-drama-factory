param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectRoot "apps\web\public\samples\beijing-marriage"
$chapterNames = @("第一", "第二", "第三", "第四", "第五", "第六", "第七", "第八", "第九", "第十", "第十一", "第十二")

function Read-Utf8([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Missing required file: $Path" }
  return (Get-Content -LiteralPath $Path -Encoding utf8 -Raw).Trim()
}

function Title-From([string]$Content, [int]$EpisodeNo) {
  $match = [regex]::Match($Content, "第$EpisodeNo集《([^》]+)》")
  if ($match.Success) { return $match.Groups[1].Value }
  return "第 $EpisodeNo 集"
}

function Asset-Records([string]$Directory, [string]$Type) {
  return @(Get-ChildItem -LiteralPath $Directory -File -Filter "*.md" | Sort-Object Name | ForEach-Object {
    $content = Read-Utf8 $_.FullName
    $name = ($_.BaseName -split "｜")[0]
    [pscustomobject][ordered]@{ id = "$Type`_$name"; name = $name; type = $Type; content = $content }
  })
}

$episodes = for ($index = 0; $index -lt 12; $index++) {
  $episodeNo = $index + 1
  $script = Read-Utf8 (Join-Path $SourceRoot "02-小说转剧本\$($chapterNames[$index])章剧本.md")
  $storyboard = Read-Utf8 (Join-Path $SourceRoot ("04-分镜头\第{0:D2}集分镜.md" -f $episodeNo))
  $videoPrompt = Read-Utf8 (Join-Path $SourceRoot ("05-即梦15s提示词\第{0:D2}集-即梦15s提示词.md" -f $episodeNo))
  [pscustomobject][ordered]@{
    episodeNo = $episodeNo
    title = Title-From $script $episodeNo
    script = $script
    storyboard = $storyboard
    videoPrompt = $videoPrompt
  }
}

$characters = Asset-Records (Join-Path $SourceRoot "03-视觉资产\角色") "character"
$scenes = Asset-Records (Join-Path $SourceRoot "03-视觉资产\场景") "scene"
$scenes = @($scenes | Where-Object { $_.name -ne "00-场景提示词汇总" })
$props = Asset-Records (Join-Path $SourceRoot "03-视觉资产\物品") "prop"

if ($episodes.Count -ne 12) { throw "Expected 12 episodes, found $($episodes.Count)." }
if ($characters.Count -ne 6) { throw "Expected 6 characters, found $($characters.Count)." }
if ($scenes.Count -ne 18) { throw "Expected 18 scenes, found $($scenes.Count)." }
if ($props.Count -ne 10) { throw "Expected 10 props, found $($props.Count)." }

$manifest = [ordered]@{
  version = 2
  importKey = "manju:beijing-marriage:v1"
  title = "北境婚书"
  sourceType = "script"
  description = "12章小说改编的12集正式漫剧项目"
  production = [ordered]@{
    episodeDurationSeconds = 180
    sourceCharactersPerEpisode = 20000
    segmentProfile = "jimeng_15s"
    videoRatio = "16:9"
    artStyle = "新三维国风、3D半写实商业CG、低饱和冷蓝与暗红点色"
  }
  episodes = $episodes
  assets = [ordered]@{ characters = $characters; scenes = $scenes; props = $props }
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDir "manifest.json") -Encoding utf8
Write-Host "PACKAGE_OK episodes=$($episodes.Count) characters=$($characters.Count) scenes=$($scenes.Count) props=$($props.Count)"
