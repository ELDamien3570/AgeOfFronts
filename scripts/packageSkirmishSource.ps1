$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskOutput = Join-Path $taskRoot 'resources\age-of-fronts-source.zip'
$taskStage = Join-Path ([IO.Path]::GetTempPath()) ('AgeOfFronts-source-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskStage | Out-Null
$taskExcluded = @('.git', 'node_modules', 'build', 'static', '.worktrees', '.claude', '.agents', '.codex', '.aws', '.cache')
Get-ChildItem -LiteralPath $taskRoot -Force | Where-Object { $_.Name -notin $taskExcluded -and $_.Name -notlike '.env*' -and $_.Name -notlike '.tmp-*' -and $_.Extension -ne '.log' } | ForEach-Object {
    if ($_.Name -eq 'resources') {
        $taskResources = Join-Path $taskStage 'resources'
        New-Item -ItemType Directory -Path $taskResources | Out-Null
        Get-ChildItem -LiteralPath $_.FullName -Force | Where-Object { $_.Name -ne 'age-of-fronts-source.zip' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $taskResources -Recurse }
    } else { Copy-Item -LiteralPath $_.FullName -Destination $taskStage -Recurse }
}
Compress-Archive -Path (Join-Path $taskStage '*') -DestinationPath $taskOutput -CompressionLevel Fastest -Force
Write-Output "Corresponding source: $taskOutput"
# The staging folder is retained in TEMP. No recursive deletion is performed.
