# Deploy Lynechat on Oracle Cloud "Always Free"

Result: Lynechat at `https://mail.yourdomain.com`, protected by a password, running 24/7. It costs $0 as long as you stay within Oracle's Always Free limits.

Time needed: about 45 minutes, plus the wait for DNS to update.

---

## 1. Create the server (Oracle console)

1. Sign in at cloud.oracle.com and go to **☰ → Compute → Instances → Create instance**.
2. **Name:** `lynechat`.
3. **Image and shape → Edit:**
   - **Image:** **Canonical Ubuntu 24.04** (or 22.04).
   - **Shape:**
     - Ampere: **VM.Standard.A1.Flex**, 1 OCPU and 6 GB of memory is plenty. This stays within the free 2 OCPU / 12 GB.
     - Or AMD: **VM.Standard.E2.1.Micro** (1 GB, also free). The install script adds 2 GB of swap for it.
   - Check that the console shows the **"Always Free-eligible"** label.
4. **Networking:** keep the defaults (new virtual cloud network and public subnet) and leave **"Assign a public IPv4 address"** checked.
5. **Add SSH keys:** choose **"Generate a key pair for me"**, then click **Save private key**. Keep this `.key` file safe: it is your only way into the server.
6. Click **Create**. When the status is **Running**, note the **Public IP address**.

> If you get "Out of capacity" for Ampere A1, try another availability domain, try again later, or use the AMD Micro shape.

## 2. Open ports 80 and 443 in Oracle's network firewall

The install script opens the server's own firewall. Oracle also has a **network** firewall that only you can change in the console.

1. Open the instance page, click the **subnet** link, then the **Default Security List**.
2. Click **Add Ingress Rules** and add two rules:

| Source CIDR | IP protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

3. Click **Add Ingress Rules** to save.

## 3. Point your subdomain to the server

At your domain registrar or DNS provider, create this record:

| Type | Name | Value |
|---|---|---|
| A | `mail` (or the subdomain you want) | the server's public IP |

## 4. Send Lynechat to the server (from Windows PowerShell)

Put `lynechat-web.zip` and your `.key` file in the same folder, open PowerShell in that folder, and run:

```powershell
# Once: protect the key, otherwise SSH refuses to use it
icacls .\ssh-key.key /inheritance:r
icacls .\ssh-key.key /grant:r "$($env:USERNAME):(R)"

# Copy the application to the server (replace the IP)
scp -i .\ssh-key.key .\lynechat-web.zip ubuntu@SERVER_IP:~

# Connect to the server
ssh -i .\ssh-key.key ubuntu@SERVER_IP
```

Replace `ssh-key.key` with the actual name of your downloaded key file.

## 5. Install (on the server, after `ssh`)

```bash
sudo apt-get update && sudo apt-get install -y unzip
unzip -o lynechat-web.zip
cd lynechat
sudo bash deploy/install.sh mail.yourdomain.com
```

The script will:
- install Node.js 24 and Caddy;
- install Lynechat as a dedicated service;
- **ask for your login password** (12 characters minimum);
- set up automatic HTTPS (free Let's Encrypt certificate);
- open the server firewall;
- schedule a daily database backup, kept 14 days;
- turn on automatic security updates.

When it finishes, open **https://mail.yourdomain.com** and sign in. Then follow the in-app **Paramètres** steps as before: AWS keys, infrastructure, domain, legal details.

## Day-to-day

| Task | Command (on the server) |
|---|---|
| See what Lynechat is doing | `sudo journalctl -u lynechat -f` |
| Restart | `sudo systemctl restart lynechat` |
| Change the password | `printf '%s\n' 'NEW-PASSWORD' \| sudo -u lynechat env LYNECHAT_DATA_DIR=/var/lib/lynechat node /opt/lynechat/server/server.js --set-password && sudo systemctl restart lynechat` |
| Update Lynechat | copy the new zip, `unzip -o lynechat-web.zip && cd lynechat && sudo bash deploy/install.sh mail.yourdomain.com` (data and password are kept) |
| Backups | `/var/lib/lynechat/backups/` (one file per day) |
| Download a backup to your PC | `scp -i .\ssh-key.key ubuntu@SERVER_IP:/var/lib/lynechat/backups/lynechat-YYYY-MM-DD.sqlite .` (first run `sudo cp` it to `~` and `sudo chown ubuntu` it) |

## Security notes

- Only Caddy (ports 80/443) is exposed. Lynechat itself listens on `127.0.0.1:3000` only.
- Login is limited to 8 attempts per 15 minutes per IP address. Sessions last 14 days and use secure, HttpOnly cookies.
- AWS keys are stored in `/var/lib/lynechat/secrets.json`, readable only by the `lynechat` system account. Anyone with root access to the server can read them, so keep your SSH key private.
- Oracle can change Always Free terms. It reduced the Ampere limits in June 2026. Keep the daily backups and download one from time to time.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser can't reach the site | Security list ingress rules (step 2) are missing, or the DNS A record isn't updated yet (`dig mail.yourdomain.com`). |
| Certificate or HTTPS error | The DNS didn't point to the server when Caddy first started. Wait a few minutes, then run `sudo systemctl restart caddy`. |
| "Le service lynechat ne démarre pas" | Read `sudo journalctl -u lynechat -n 50` and send me the output. |
