# Redeploy Age of Fronts on Oracle

This guide updates the existing `ageoffronts` Ubuntu server in US East
(Ashburn). Public IP: `129.158.227.109`. Website: https://www.ageoffronts.com.
The verified release when this guide was written is
`ce5a316f3c8ed62be58637a63c5d222978a40dd0`.

Routine releases use SSH to run the repository's deployment script on Oracle.
They reuse the existing server, disk, database, HTTPS configuration and DNS.

## 1. Test and push your changes

In PowerShell, inside your local repository, run:

```powershell
cd C:\Users\Damien\Documents\GitHub\AgeOfFronts\AgeOfFronts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts --maxWorkers=2 --testTimeout=15000
node node_modules/vite/bin/vite.js build --config vite.skirmish.config.ts
```

These commands assume the repository's dependencies are already installed.
Fix failures before continuing. Commit and push the changes to `main`, using
GitHub Desktop or your usual Git workflow. Wait for Git LFS uploads to finish.
Confirm that the intended commit appears on GitHub's `main` branch.

## 2. Check the existing Oracle instance

Sign in to Oracle, select **US East (Ashburn)**, and open **Compute → Instances**.
The `ageoffronts` instance should be **Running**, with public IP
`129.158.227.109`. Routine redeployment does not require creating, resizing or
rebooting the instance.

## 3. Connect from Windows PowerShell

```powershell
ssh -i "C:\Users\Damien\.ssh\ageoffronts_oracle" ubuntu@129.158.227.109
```

The prompt should change to an Ubuntu shell. All remaining shell commands below
run **on Oracle**, rather than in Windows PowerShell. The private key stays on
your computer.

If SSH times out, confirm the instance is Running. This server restricts SSH to
your public IP; if your home IP changed, update the subnet's SSH ingress rule
to your new address followed by `/32`, TCP destination port 22, source ports All.
Keep that rule restricted to your address. See Oracle's
[connection guide](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/accessinginstance.htm)
and [security-list documentation](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm).

## 4. Choose a quiet deployment window

```bash
curl -fsS http://127.0.0.1:8080/healthz
```

Wait until `activeMatches` is `0`. Ask players to avoid starting new matches
until the release finishes: restarting the application loses active matches.
The script checks again after building, but it does not lock new admissions
between that check and the restart.

## 5. Fetch the exact main revision and save the rollback revision

Run these lines in order. Stop if a command fails.

```bash
sudo git -C /opt/ageoffronts/repo fetch origin
target_revision=$(sudo git -C /opt/ageoffronts/repo rev-parse origin/main)
printf 'Deploying: %s\n' "$target_revision"
cat /opt/ageoffronts/current-revision > ~/ageoffronts-previous-revision
```

Check that the printed commit is the one you tested and pushed. `target_revision`
pins that exact version even if `main` changes during deployment.

## 6. Run the release script from that revision

```bash
sudo git -C /opt/ageoffronts/repo show "$target_revision:deploy/oracle/release.sh" > ~/ageoffronts-release.sh
sudo bash ~/ageoffronts-release.sh "$target_revision"
```

Leave the SSH session open while it runs. The script fetches required LFS map
and artwork assets, builds the image, checks active matches, backs up SQLite,
starts the containers, waits for health checks and reloads Caddy.

Success ends with a healthy JSON response and `Release <commit> started`.
If it reports active matches, wait for them to finish and rerun the second line.
If a build or health check fails, inspect the error before retrying; do not
assume a failed release completed successfully.

## 7. Verify the release

```bash
cat /opt/ageoffronts/current-revision
curl -fsS http://127.0.0.1:8080/healthz
sudo docker ps --format '{{.Names}} {{.Status}}'
sudo docker logs --tail 50 ageoffronts-app-1
```

The revision should match `target_revision`; health should report `status: ok`.
Open https://www.ageoffronts.com and refresh any previously opened tabs. Check
that the lobby connects and that **Corresponding source** links to the deployed
commit. Start a small match with two browsers/devices, verify both enter and the
simulation advances, then leave it. Check that `activeMatches` returns to `0`.

## 8. Roll back if the application update is faulty

With no active matches, run:

```bash
rollback_revision=$(cat ~/ageoffronts-previous-revision)
printf 'Rolling back to: %s\n' "$rollback_revision"
sudo git -C /opt/ageoffronts/repo show "$rollback_revision:deploy/oracle/release.sh" > ~/ageoffronts-rollback.sh
sudo bash ~/ageoffronts-rollback.sh "$rollback_revision"
```

Repeat step 7. This rolls back application code and preserves the current
database. For a future release that changes the database schema, verify that the
older application can read it before rolling back.

## Backup locations

SQLite lives at `/opt/ageoffronts/data/multiplayer.sqlite`. Verified local backups
are retained for seven days in `/opt/ageoffronts/backups`. Those copies share the
server's disk; the existing Oracle boot-volume backup is separate recovery
protection. Keep additional Oracle backups within the account's free allowance.
