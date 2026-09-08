param([ValidateSet('web-desktop', 'wechatgame')][string]$Platform = 'web-desktop')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$creatorPath = if ($env:COCOS_CREATOR) { $env:COCOS_CREATOR } else { 'C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe' }
if (-not (Test-Path -LiteralPath $creatorPath)) { throw 'Set COCOS_CREATOR to Cocos Creator 3.8.8 executable.' }
$logDirectory = Join-Path $projectRoot 'temp\verification-build'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$config = @{
  name = 'SkillLudo'; platform = $Platform; buildPath = 'project://build'; outputName = $Platform
  debug = ($env:SKILLLUDO_DEBUG_BUILD -eq '1'); md5Cache = $false
  startScene = '5d2a7d9e-0b41-4e93-9f42-b7c19da63875'
  scenes = @(@{ url = 'db://assets/scenes/Main.scene'; uuid = '5d2a7d9e-0b41-4e93-9f42-b7c19da63875' })
}
if ($Platform -eq 'wechatgame') {
  $appId = if ($env:WECHAT_APP_ID) { $env:WECHAT_APP_ID } else { 'touristappid' }
  $config.packages = @{ wechatgame = @{ appid = $appId; orientation = 'landscape'; separateEngine = $false } }
}
$configPath = Join-Path $logDirectory "$Platform.json"
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding utf8
Write-Output "Building $Platform with Creator 3.8.8..."
$arguments = @('--project', ('"' + $projectRoot + '"'), '--build', ('"configPath=' + $configPath + '"'))
$process = Start-Process -FilePath $creatorPath -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $logDirectory "$Platform.stdout.log") -RedirectStandardError (Join-Path $logDirectory "$Platform.stderr.log")
Get-Content -LiteralPath (Join-Path $logDirectory "$Platform.stdout.log") -Tail 16
if ($process.ExitCode -ne 36 -and $process.ExitCode -ne 0) { Get-Content -LiteralPath (Join-Path $logDirectory "$Platform.stderr.log") -Tail 25; throw "Creator exit code $($process.ExitCode)" }
Write-Output "Creator $Platform build completed (exit $($process.ExitCode))."
