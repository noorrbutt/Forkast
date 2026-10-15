# Troubleshooting

**Port 8010, not 8000.** Another project on the original dev machine owns 8000.
Windows lets two processes bind the same port rather than refusing, so the
symptom is not a bind error, it is your requests being answered by the wrong
server. If a response looks like it came from a different app, that is why.

**`localhost` does not work from a phone.** Expo Go runs on the handset, where
`localhost` is the handset. Put your machine's LAN address in
`mobile/.env.local`:

```
EXPO_PUBLIC_API_URL=http://192.168.1.10:8010
```

Find it with `ipconfig` (Windows) or `ip addr` / `ifconfig`. It is a DHCP lease,
so it changes when you rejoin the network. After editing it, do a full reload in
Expo Go; hot refresh will not pick it up. `curl http://<that ip>:8010/health`
from the phone's browser is the fastest way to confirm the path works.

**Windows firewall.** The phone cannot reach the laptop until the firewall allows
it, and if Windows has classified the network as Public then Private profile
rules do not apply. Check with `Get-NetConnectionProfile`, then in an elevated
shell:

```powershell
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
New-NetFirewallRule -DisplayName "Forkast API" -Direction Inbound -LocalPort 8010 -Protocol TCP -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "Expo Metro"  -Direction Inbound -LocalPort 8081 -Protocol TCP -Action Allow -Profile Private
```

**Expo Go sign in.** On SDK 57 you must sign in twice: `npx expo login` in the
terminal, and again inside the Expo Go app. A QR scan alone will fail.

**`pip install` fails on a wheel.** Intended. Check your Python version is
3.12 or 3.14 rather than letting pip compile from source.

**Tests refuse to start.** `TEST_DATABASE_URL` is unset or points at the same
database as `DATABASE_URL`. The suite truncates tables, so it refuses on purpose.

**Estimates never get "refined".** No worker is running, or the AI circuit
breaker is open. Check `GET /queue`.

**Migrations fail with "function uuidv7() does not exist".** You are on
PostgreSQL older than 18.
