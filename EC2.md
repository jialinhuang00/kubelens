# EC2 Deploy Guide

## Access

```bash
ssh kubelens          # alias in ~/.ssh/config
```

SSH config entry:

```
Host kubelens
  HostName <EC2_PUBLIC_IP>
  User ec2-user
  IdentityFile ~/.ssh/<KEY_NAME>.pem
```

## Server Layout

| Item | Value |
|------|-------|
| Path | `/home/ec2-user/kubelens/` |
| Entry | `api/index.js` (via tsx) |
| Process manager | pm2 — name: `kubelens` |
| Port | 8080 |

## Build

| Layer | Command | Output |
|-------|---------|--------|
| Frontend (Angular) | `npm run build` | `dist/kubelens/browser/` |
| Backend (Express) | no build needed | tsx runs `api/index.js` directly |

## Deploy

```bash
cd kubelens
git pull
npm run build
pm2 restart kubelens
```

## pm2 Cheatsheet

| Command | Purpose |
|---------|---------|
| `pm2 list` | list processes |
| `pm2 logs kubelens` | stream logs |
| `pm2 restart kubelens` | restart |
| `pm2 stop kubelens` | stop |
| `pm2 show kubelens` | details |

## Known Issues

- `git pull` can leave merge conflict markers in `api/index.js` — pm2 crash-loops until resolved. Check with `grep -n '<<<<' api/index.js` after every pull.
