param([string]$Root, [string]$Stage, [string]$Target)
$ErrorActionPreference = 'Stop'
$weaponRootPath = (Resolve-Path -LiteralPath $Root).Path
$weaponStagePath = (Resolve-Path -LiteralPath $Stage).Path
$weaponTargetPath = [System.IO.Path]::GetFullPath($Target)
$weaponRootPrefix = $weaponRootPath + [System.IO.Path]::DirectorySeparatorChar
if (-not $weaponStagePath.StartsWith($weaponRootPrefix,[System.StringComparison]::OrdinalIgnoreCase) -or -not $weaponTargetPath.StartsWith($weaponRootPrefix,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'Output leaves weapon workspace' }
if (-not (Test-Path -LiteralPath (Join-Path $weaponStagePath 'animations.json'))) { throw 'Missing staged metadata' }
if (Test-Path -LiteralPath $weaponTargetPath) { throw 'Target exists; refusing to overwrite' }
Move-Item -LiteralPath $weaponStagePath -Destination $weaponTargetPath
