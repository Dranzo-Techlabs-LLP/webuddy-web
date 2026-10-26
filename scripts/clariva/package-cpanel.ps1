<#
.SYNOPSIS
  Packages the built Clariva Web app (webapp\) into a zip that can be uploaded to cPanel (docs/clariva/DEPLOY-CPANEL.md).

.DESCRIPTION
  What it does, in order:
    1. Reads webapp\index.html and finds the ONE bundles\<hash>\ directory the app really loads. Older build directories that
       piled up in webapp\bundles are left out (they were 600+ MB of dead weight), and so are i18n files languages.json does not
       reference.
    2. Leaves out every *.map source-map file, the empty .well-known\ and apple-app-site-association placeholders (extracting
       them over a real Digital Asset Links file would break Android App Links) and OS junk files.
    3. Replaces webapp\config.json with the PRODUCTION config (config.clariva.json by default). webapp\config.json is often the
       local-test config (localhost:8008): it must never reach the server. Every URL in the config must be https on a public DNS
       name.
    4. Adds deploy\cpanel\.htaccess (headers, caching, HTTPS, /u/ deep links) plus the immutable-cache .htaccess for the hashed
       folders (all LF line endings, no BOM).
    5. Checks the result (nothing missing compared with webapp\, nothing leaked) and writes dist\clariva-web-cpanel.zip (forward
       slash paths, dotfiles included, no top-level folder). The old zip is replaced only when the new one is complete.

  The zip is meant to be extracted DIRECTLY into an EMPTY web root (a dedicated subdomain's document root), so index.html ends up
  next to .htaccess.

.PARAMETER Config
  Production config file, relative to the repo root. Default: config.clariva.json

.PARAMETER Output
  Zip path, relative to the repo root. Default: dist\clariva-web-cpanel.zip  (dist\ is git-ignored)

.PARAMETER Version
  The VERSION the bundle was built with (VERSION=26.10.1 yarn build). When given, the script checks the bundle really carries that
  string (and not "!!UNSET!!") and writes it to a `version` file so open browser tabs learn about new deployments. Never pass a
  version that differs from the build stamp: the app would reload on every visit. Without it the zip has no `version` file.

.PARAMETER I18nPatch
  Also write dist\clariva-web-i18n-patch.zip: ONLY the i18n\ folder. Extract it over an existing deployment to fix the translations
  without touching config.json / .htaccess / anything else on the server.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\clariva\package-cpanel.ps1
  powershell -ExecutionPolicy Bypass -File scripts\clariva\package-cpanel.ps1 -Version 26.10.1
  powershell -ExecutionPolicy Bypass -File scripts\clariva\package-cpanel.ps1 -I18nPatch
#>
[CmdletBinding()]
param(
    [string]$Config = 'config.clariva.json',
    [string]$Output = 'dist\clariva-web-cpanel.zip',
    [ValidatePattern('^$|^[0-9A-Za-z][0-9A-Za-z._-]*$')]
    [string]$Version = '',
    [switch]$I18nPatch
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$webapp = Join-Path $repo 'webapp'
$stage = Join-Path $repo 'dist\cpanel-stage'
$zip = Join-Path $repo $Output
$zipTmp = "$zip.tmp"
$patchZip = Join-Path (Split-Path $zip) 'clariva-web-i18n-patch.zip'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$warnings = New-Object System.Collections.Generic.List[string]

function Step([string]$m) { Write-Host "`n>> $m" -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "   $m" -ForegroundColor Green }
function Warn([string]$m) { $warnings.Add($m); Write-Host "   WARNING: $m" -ForegroundColor Yellow }
# text files that Apache reads must be LF-only, no BOM (CRLF can make LiteSpeed / older Apache reject a directive)
function Write-Lf([string]$path, [string]$text) { [System.IO.File]::WriteAllText($path, ($text -replace "`r`n", "`n"), $utf8) }

try {
    # --- 1. the build ---------------------------------------------------------------------------------------------------
    Step 'Checking the build'
    $indexPath = Join-Path $webapp 'index.html'
    if (-not (Test-Path $indexPath)) {
        throw "webapp\index.html not found. Build first (docs/clariva/DEPLOY-CPANEL.md section A), then re-run this script."
    }
    $index = Get-Content $indexPath -Raw
    # every page that loads scripts from bundles/<hash>/ must agree on ONE hash (index.html, jitsi.html, usercontent/index.html,
    # mobile_guide/index.html, ...): the other hash folders are dropped, so a page pointing at one would break silently.
    # decoder-ring/ (left out of the package) and element-call/ (its own build) are not scanned.
    $hashes = @(Get-ChildItem $webapp -Recurse -File |
        Where-Object { $_.Extension -ieq '.html' -and $_.FullName -notmatch '\\(bundles|element-call|decoder-ring)\\' } |
        ForEach-Object { [regex]::Matches([System.IO.File]::ReadAllText($_.FullName), 'bundles/([0-9a-f]{8,})/') } |
        ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    if ($hashes.Count -ne 1) {
        throw "The shipped pages reference $($hashes.Count) bundle directories ($($hashes -join ', ')); expected exactly one. Rebuild."
    }
    $live = $hashes[0]
    $liveDir = Join-Path $webapp "bundles\$live"
    if (-not (Test-Path (Join-Path $liveDir 'bundle.js'))) { throw "bundles\$live\bundle.js is missing from webapp\." }
    $stale = @(Get-ChildItem (Join-Path $webapp 'bundles') -Directory | Where-Object { $_.Name -ne $live })
    Ok "live bundle: bundles\$live   (leaving out $($stale.Count) stale build folder(s))"
    if ($stale.Count -gt 0) { Warn 'webapp\ is not a clean build (old bundle folders). Prefer a fresh "yarn build" (it cleans first) for the release.' }

    # version stamp: an unstamped build says "!!UNSET!!" in Help & About and cannot tell open tabs about a new deployment
    $unset = $false; $stamped = $false
    # the language map(s) the bundle itself loads: i18n/languages.<hash>.json (NOT the unhashed languages.json)
    $mapNames = New-Object System.Collections.Generic.HashSet[string]
    foreach ($js in (Get-ChildItem $liveDir -File | Where-Object { $_.Extension -ieq '.js' })) {
        $t = [System.IO.File]::ReadAllText($js.FullName)
        if ($t.Contains('!!UNSET!!')) { $unset = $true }
        # the stamp itself ("VERSION","26.10.1"), not any occurrence of the text: a partial version must not pass
        if ($Version -and [regex]::IsMatch($t, '"VERSION",\s*"' + [regex]::Escape($Version) + '"')) { $stamped = $true }
        foreach ($m in [regex]::Matches($t, 'languages\.[0-9a-f]{6,}\.json')) { [void]$mapNames.Add($m.Value) }
    }
    if ($Version) {
        if ($unset) { throw "The bundle is not version-stamped (it contains '!!UNSET!!'). Rebuild with `$env:VERSION='$Version'; yarn build, then re-run." }
        if (-not $stamped) { throw "The bundle does not contain the version string '$Version'. Pass the VERSION the build was made with." }
        Ok "version stamp: $Version (a version file will be written)"
    } elseif ($unset) {
        Warn "The bundle is NOT version-stamped: Help & About shows '!!UNSET!!' and open tabs are never told about a new deployment. Rebuild with VERSION (guide section A) and pass -Version."
    } else {
        Warn 'The bundle is version-stamped but -Version was not given: no version file is written, so open tabs are not told about new deployments.'
    }

    # --- 2. the production config ---------------------------------------------------------------------------------------
    Step "Checking the production config ($Config)"
    $cfgPath = Join-Path $repo $Config
    if (-not (Test-Path $cfgPath)) { throw "$Config not found." }
    # explicit UTF-8: Windows PowerShell 5.1's Get-Content reads a BOM-less file as ANSI and would mangle any non-ASCII character
    $cfgText = [System.IO.File]::ReadAllText($cfgPath)
    $cfg = $cfgText | ConvertFrom-Json

    $urls = New-Object System.Collections.Generic.List[string]
    function Get-Urls($o) {
        if ($o -is [string]) { if ($o -match '^[A-Za-z][A-Za-z0-9+.-]*://') { $urls.Add($o) } }
        elseif ($o -is [System.Management.Automation.PSCustomObject]) { foreach ($p in $o.PSObject.Properties) { Get-Urls $p.Value } }
        elseif ($o -is [System.Collections.IEnumerable]) { foreach ($x in $o) { Get-Urls $x } }
    }
    Get-Urls $cfg
    if ($urls.Count -eq 0) { throw "$Config contains no absolute URLs: that is not a production config." }
    foreach ($u in $urls) {
        $uri = $null
        if (-not [System.Uri]::TryCreate($u, [System.UriKind]::Absolute, [ref]$uri)) { throw "$Config has an unparseable URL: $u" }
        if ($uri.Scheme -ne 'https') { throw "$Config has a non-https URL: $u" }
        $hostName = $uri.Host.TrimEnd('.')
        if ($uri.HostNameType -ne [System.UriHostNameType]::Dns -or $hostName -notmatch '\.' -or $uri.UserInfo -or
            $hostName -match '(^|\.)(local|localhost|localdomain|test|internal|intranet|corp|lan|invalid|example|home\.arpa)$') {
            throw "$Config has a URL that is not on a public DNS name (local test config?): $u"
        }
    }
    $hs = $cfg.default_server_config.'m.homeserver'.base_url
    $api = $cfg.clariva.api_base_url
    if (-not $hs) { throw 'default_server_config.m.homeserver.base_url is missing.' }
    if (-not $api) { throw 'clariva.api_base_url is missing: without it every Clariva feature is dormant (plain Element Web).' }
    if (-not $cfg.clariva.matrix_server_name) { throw 'clariva.matrix_server_name is missing.' }
    if ($cfg.clariva.features.google_sign_in -and -not ($cfg.clariva.google_client_id -match '\.apps\.googleusercontent\.com$')) {
        throw 'clariva.features.google_sign_in is true but clariva.google_client_id is missing or malformed.'
    }
    Ok "homeserver: $hs"
    Ok "wallet api: $api"
    Ok "google sign-in: $($cfg.clariva.features.google_sign_in)   calls: $($cfg.clariva.features.calls)   ($($urls.Count) URLs checked, all https on public hosts)"
    if (-not $cfg.permalink_prefix) { Warn 'config has no permalink_prefix: room/user permalinks stay matrix.to. Set it to the site origin after the origin is final (guide section C.5).' }

    # --- 3. stage -------------------------------------------------------------------------------------------------------
    Step 'Staging files'
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    # decoder-ring\ is an upstream developer tool (needs the source maps we leave out) that loads UNPINNED scripts (rxjs, react) from
    # unpkg.com on the app's own origin, without a CSP, and nothing in the app links to it: not shipped.
    $xd = @($stale | ForEach-Object { $_.FullName }) + @((Join-Path $webapp '.well-known'), (Join-Path $webapp 'decoder-ring'))
    # exclude ONLY the top-level config.json / apple-app-site-association (by full path): element-call\config.json must be kept
    $xf = @('*.map', (Join-Path $webapp 'config.json'), (Join-Path $webapp 'apple-app-site-association'), 'Thumbs.db', 'desktop.ini', '.DS_Store')
    # /R:1 /W:1: a locked file fails fast instead of retrying a million times
    & robocopy $webapp $stage /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XF @xf /XD @xd | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }

    # i18n: webapp\ keeps every language file of every past build. The BUNDLE names the language map it loads
    # (languages.<hash>.json, found above); that map lists the per-language files. Keep the map(s) the bundle names, the unhashed
    # languages.json the build also writes, and every file those maps list; drop the rest. Pruning on languages.json alone
    # deleted the hashed map the app really requests (every UI string then shows as a raw "common|home" key), so a missing
    # map is a hard error here, never a silent prune.
    $i18nKeep = New-Object System.Collections.Generic.HashSet[string]
    if ($mapNames.Count -eq 0) {
        Warn 'The bundle names no i18n language map: i18n was shipped unpruned.'
        foreach ($f in (Get-ChildItem (Join-Path $stage 'i18n') -File)) { [void]$i18nKeep.Add($f.Name) }
    } else {
        $maps = @($mapNames) + @('languages.json')
        foreach ($m in $maps) {
            $mp = Join-Path $stage "i18n\$m"
            if (-not (Test-Path -LiteralPath $mp)) { if ($m -eq 'languages.json') { continue }; throw "The bundle loads i18n\$m but it is missing from webapp\i18n. Rebuild." }
            [void]$i18nKeep.Add($m)
            $lang = [System.IO.File]::ReadAllText($mp) | ConvertFrom-Json
            # a map that lists no English file would ship an app whose every UI string is a raw "common|home" key
            if ($lang.PSObject.Properties.Name -notcontains 'en') { throw "i18n\$m lists no 'en' (the fallback language)." }
            foreach ($p in $lang.PSObject.Properties) { [void]$i18nKeep.Add([string]$p.Value) }
        }
        foreach ($need in $i18nKeep) { if (-not (Test-Path -LiteralPath (Join-Path $stage "i18n\$need"))) { throw "A language map references i18n\$need which is missing." } }
        $drop = @(Get-ChildItem (Join-Path $stage 'i18n') -File | Where-Object { $_.Extension -ieq '.json' -and -not $i18nKeep.Contains($_.Name) })
        $drop | Remove-Item -Force
        Ok "i18n: kept $($i18nKeep.Count) files (map(s): $(@($mapNames) -join ', ')), dropped $($drop.Count) unreferenced"
    }

    Write-Lf (Join-Path $stage 'config.json') $cfgText
    Write-Lf (Join-Path $stage '.htaccess') ([System.IO.File]::ReadAllText((Join-Path $repo 'deploy\cpanel\.htaccess')))
    if ($Version) { [System.IO.File]::WriteAllText((Join-Path $stage 'version'), $Version, $utf8) }

    # Wrapped in <FilesMatch>: Apache merges the parent .htaccess <FilesMatch> blocks (1-day images / fonts / sounds) AFTER plain
    # directory-level directives, so a bare "Header set" here would lose against them for .png/.svg/.mp3/... inside these folders.
    $immutable = @'
# Content-hashed files: safe to cache for a year (same policy as nginx/conf.d/default.conf).
<IfModule mod_headers.c>
    <FilesMatch ".">
        Header set Cache-Control "public, max-age=31536000, immutable"
    </FilesMatch>
</IfModule>
'@
    foreach ($d in @('bundles', 'element-call\assets')) {
        $dir = Join-Path $stage $d
        if (Test-Path $dir) { Write-Lf (Join-Path $dir '.htaccess') $immutable }
        else { Warn "$d not found in the build; skipped its cache .htaccess" }
    }

    # --- 4. sanity checks -----------------------------------------------------------------------------------------------
    Step 'Sanity checks'
    $files = @(Get-ChildItem $stage -Recurse -Force -File)
    $maps = @($files | Where-Object { $_.Extension -ieq '.map' })
    if ($maps.Count -gt 0) { throw "$($maps.Count) source map(s) leaked into the package." }
    $required = @('index.html', 'config.json', '.htaccess', "bundles\$live\bundle.js", 'element-call\index.html', 'element-call\config.json', 'static\unable-to-load.html')
    if ($Version) { $required += 'version' }
    # the bundle fetches ONLY its hashed language map(s); the unhashed languages.json is optional (a fallback if the bundle names none)
    foreach ($m in $mapNames) { $required += "i18n\$m" }
    if ($mapNames.Count -eq 0) { $required += 'i18n\languages.json' }
    $i18nMustHave = if ($mapNames.Count -gt 0) { @($mapNames | ForEach-Object { "i18n/$_" }) } else { @('i18n/languages.json') }
    foreach ($must in $required) { if (-not (Test-Path -LiteralPath (Join-Path $stage $must))) { throw "missing in package: $must" } }
    foreach ($never in @('.well-known', 'apple-app-site-association', 'decoder-ring')) {
        if (Test-Path -LiteralPath (Join-Path $stage $never)) { throw "$never must not be in the package (it could overwrite a real file on the host)." }
    }
    foreach ($h in @($files | Where-Object { $_.Name -eq '.htaccess' })) {
        # test the BYTES: ReadAllText silently strips a BOM, so a decoded-text check could never see one
        $b = [System.IO.File]::ReadAllBytes($h.FullName)
        if ($b -contains 0x0D) { throw "$($h.FullName) contains CR characters (must be LF only)." }
        if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { throw "$($h.FullName) starts with a UTF-8 BOM (Apache answers 500 to a BOM before the first directive)." }
    }
    # the shipped Element Call config must be byte-identical to the one the Android app's Element Call build uses
    $ecSrc = Join-Path $repo 'res\element-call\config.json'
    if (Test-Path $ecSrc) {
        if ((Get-FileHash $ecSrc).Hash -ne (Get-FileHash (Join-Path $stage 'element-call\config.json')).Hash) { throw 'element-call\config.json differs from res\element-call\config.json.' }
    } else { Warn 'res\element-call\config.json not found: could not compare the Element Call config.' }
    $ecCfg = [System.IO.File]::ReadAllText((Join-Path $stage 'element-call\config.json'))
    if ($ecCfg -match 'localhost|127\.0\.0\.1') { throw 'element-call\config.json points at localhost.' }

    # nothing the app needs may be missing compared with webapp\ (only the deliberate exclusions below are allowed to differ)
    $missing = New-Object System.Collections.Generic.List[string]
    $droppedI18n = New-Object System.Collections.Generic.List[string]
    foreach ($f in (Get-ChildItem $webapp -Recurse -Force -File)) {
        $rel = $f.FullName.Substring($webapp.Length + 1)
        if ($f.Extension -ieq '.map') { continue }
        if ($rel -ieq 'config.json' -or $rel -ieq 'apple-app-site-association' -or $rel -like '.well-known\*' -or $rel -like 'decoder-ring\*') { continue }
        if ($f.Name -in @('Thumbs.db', 'desktop.ini', '.DS_Store')) { continue }
        if ($rel -like 'bundles\*' -and $rel -notlike "bundles\$live\*") { continue }
        if ($rel -like 'i18n\*.json' -and -not $i18nKeep.Contains($f.Name)) { $droppedI18n.Add($f.Name); continue }
        if (-not (Test-Path -LiteralPath (Join-Path $stage $rel))) { $missing.Add($rel) }
    }
    if ($missing.Count -gt 0) { throw "files from webapp\ are missing in the package: $(($missing | Select-Object -First 5) -join ', ')" }

    # ...and the other direction: nothing left out on purpose may be NAMED by the app (live bundle, index.html, service worker).
    # This is what would have caught the pruned language map (the bundle names it; languages.json does not matter).
    $texts = @(Get-ChildItem $liveDir -File | Where-Object { $_.Extension -ieq '.js' -or $_.Extension -ieq '.css' }) + @(Get-Item $indexPath) + @(Get-ChildItem $webapp -File -Filter 'sw.js')
    foreach ($tf in $texts) {
        $t = [System.IO.File]::ReadAllText($tf.FullName)
        foreach ($n in $droppedI18n) { if ($t.Contains($n)) { throw "$($tf.Name) names i18n\$n, which the package leaves out." } }
    }
    Ok "references: none of the $($droppedI18n.Count) dropped i18n files is named by the bundle; language map(s) shipped: $(@($mapNames) -join ', ')"
    $bytes = ($files | Measure-Object Length -Sum).Sum
    Ok "$($files.Count) files, $([math]::Round($bytes / 1MB, 1)) MiB uncompressed; no source maps; nothing missing vs webapp\; production config in place"

    # --- 5. zip ---------------------------------------------------------------------------------------------------------
    Step "Creating $Output"
    New-Item -ItemType Directory -Force -Path (Split-Path $zip) | Out-Null
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    # Entry by entry instead of ZipFile.CreateFromDirectory (and Compress-Archive): Windows PowerShell 5.1 writes BACKSLASH path
    # separators with those, which Linux unzip / cPanel's extractor turn into files literally named "bundles\x\y.js".
    # Entries are relative to the stage, so index.html and .htaccess sit at the top level (no wrapping folder). The new zip is
    # verified (entry count, no backslashes, required top-level names) before it replaces the previous one.
    function Write-Zip([string]$target, $fileList, [string[]]$mustHave) {
        $tmp = "$target.tmp"
        if (Test-Path $tmp) { Remove-Item $tmp -Force }
        $fsOut = [System.IO.File]::Open($tmp, [System.IO.FileMode]::Create)
        $archive = New-Object System.IO.Compression.ZipArchive($fsOut, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($f in ($fileList | Sort-Object FullName)) {
                $rel = $f.FullName.Substring($stage.Length + 1).Replace('\', '/')
                $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
                $when = $f.LastWriteTime; if ($when.Year -lt 1980) { $when = Get-Date '1980-01-01' }
                $entry.LastWriteTime = [DateTimeOffset]$when
                $es = $entry.Open()
                $in = [System.IO.File]::OpenRead($f.FullName)
                try { $in.CopyTo($es) } finally { $in.Dispose(); $es.Dispose() }
            }
        } finally {
            $archive.Dispose()
            $fsOut.Dispose()
        }
        $za = [System.IO.Compression.ZipFile]::OpenRead($tmp)
        try {
            $count = $za.Entries.Count
            $bad = @($za.Entries | Where-Object { $_.FullName -like '*\*' })
            $names = @($za.Entries | ForEach-Object { $_.FullName })
        } finally { $za.Dispose() }
        if ($count -ne @($fileList).Count) { Remove-Item $tmp -Force; throw "$target has $count entries, expected $(@($fileList).Count)" }
        if ($bad.Count -gt 0) { Remove-Item $tmp -Force; throw "$target contains $($bad.Count) entries with backslash separators" }
        foreach ($top in $mustHave) { if ($names -notcontains $top) { Remove-Item $tmp -Force; throw "$top is not in $target" } }
        Move-Item -LiteralPath $tmp -Destination $target -Force
        return $count
    }

    $entryCount = Write-Zip $zip $files (@('index.html', '.htaccess', 'config.json') + $i18nMustHave)
    if ($I18nPatch) {
        $i18nFiles = @($files | Where-Object { $_.FullName.StartsWith((Join-Path $stage 'i18n') + '\') })
        $patchCount = Write-Zip $patchZip $i18nFiles $i18nMustHave
        Ok "patch: $patchZip ($patchCount files, i18n/ only; extract over an existing deployment)"
    }

    $zmb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
    $sha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    Write-Host ''
    Write-Host "DONE  $zip" -ForegroundColor Green
    Write-Host "      $zmb MiB zip, $entryCount files, $([math]::Round($bytes / 1MB, 1)) MiB extracted, sha256 $sha"
    Write-Host '      Extract it into an EMPTY document root. See docs/clariva/DEPLOY-CPANEL.md.'
    if ($warnings.Count -gt 0) {
        Write-Host ''
        Write-Host "$($warnings.Count) warning(s):" -ForegroundColor Yellow
        $warnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    }
} finally {
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
    foreach ($tmp in @($zipTmp, "$patchZip.tmp")) { if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue } }
}
# robocopy leaves a non-zero "success" code (1-3) in $LASTEXITCODE: a wrapper that checks it must not see a false failure
$global:LASTEXITCODE = 0
