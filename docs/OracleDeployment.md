# Oracle deployment

This setup hosts the homepage, game and existing multiplayer coordinator on one
Ubuntu 24.04 ARM VM. Caddy provides HTTPS and forwards HTTP and WebSocket traffic
to the existing application. Domain and ViewModel responsibilities are unchanged.

Use `VM.Standard.A1.Flex` with 2 OCPUs, 12 GB RAM and a 100 GB boot disk in the
tenancy's home region. Verify the console's Always Free allowances before launch;
other instances and disks consume the same account allowance. No paid load
balancer, NAT gateway, database service or container registry is required.

Allow public TCP 80 and 443. Limit TCP 22 to the administrator's public IP.
The application port 8080 is bound only to loopback on the host. Keep SSH keys
outside Git. Keep Render available until Oracle passes the cutover checks.

## Installation and release

Run `sudo bash deploy/oracle/bootstrap.sh` on a fresh Ubuntu 24.04 server. Then
run `sudo bash deploy/oracle/release.sh FULL_GIT_COMMIT` with a tested, published
revision. The release script fetches the public repository and required Git LFS
objects, builds before restarting, and refuses to restart while active matches
are reported. It retains earlier tagged application images for rollback.

The browser and coordinator are built from the same source. The frontend uses
its own origin for multiplayer, and the source link names the exact deployed
commit. Guest/lobby SQLite data persists in `/opt/ageoffronts/data`, separate
from application containers. TLS state persists in Docker volumes.

Daily SQLite backups are checked for integrity and kept for seven days under
`/opt/ageoffronts/backups`. They share the boot disk and do not protect against
losing that disk. Create an OCI boot-volume backup after successful deployment
and before material infrastructure changes; stay within the free backup quota.

## Cutover

Add an A record for `oracle.ageoffronts.com` pointing to the new server and verify
trusted HTTPS, `/healthz`, homepage, game, worker/map/artwork loading and an online
match through that staging hostname first. Plain HTTP through an IP does not
provide the secure browser context needed for all multiplayer APIs.
Change Northwest's root A record to the Oracle
public IP and `www` CNAME to `ageoffronts.com.`. Preserve MX, DKIM, DMARC, SPF and
other records. Verify trusted HTTPS for both names, root redirect to `www`, WSS,
and multiplayer through the domain before retiring the Render services.

Current rollback DNS targets are A `@` = `216.24.57.1` and CNAME `www` =
`age-of-fronts-skirmish.onrender.com.`. Recheck these against the account before
using them. To roll back an Oracle application release, deploy the previous full
commit with `release.sh`; this rebuilds that revision and preserves SQLite data.

## Limits

The initial admission ceiling is one concurrent match, pending measurement on
the actual VM. Browser hosts usually run the simulation; server fallback must
still meet the match's requirements. Active match checkpoints remain in memory:
restarts lose active matches. This hosting migration does not add durable match
recovery. Coordinate updates when matches have finished.

Always Free capacity may be unavailable and idle free instances can be reclaimed.
An Always Free VM is suitable for a small launch; it does not establish high
availability or a measured public-game capacity guarantee.
