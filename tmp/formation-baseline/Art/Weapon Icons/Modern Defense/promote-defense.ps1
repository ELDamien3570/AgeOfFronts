param([string]$Root,[string]$Stage,[string]$Target)
$ErrorActionPreference='Stop'
$artRootPath=(Resolve-Path -LiteralPath $Root).Path
$defenseStagePath=(Resolve-Path -LiteralPath $Stage).Path
$defenseTargetPath=[System.IO.Path]::GetFullPath($Target)
$artRootPrefix=$artRootPath+[System.IO.Path]::DirectorySeparatorChar
if (-not $defenseStagePath.StartsWith($artRootPrefix,[System.StringComparison]::OrdinalIgnoreCase) -or -not $defenseTargetPath.StartsWith($artRootPrefix,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'Output leaves art workspace' }
if (-not (Test-Path -LiteralPath (Join-Path $defenseStagePath 'animations.json'))) { throw 'Missing staged metadata' }
if (Test-Path -LiteralPath $defenseTargetPath) { throw 'Target exists; refusing to overwrite' }
Move-Item -LiteralPath $defenseStagePath -Destination $defenseTargetPath
