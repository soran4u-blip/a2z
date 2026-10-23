# a2z.deals

Smart deal links: short links with a 2-second price card, expiry, analytics, Pro plan (Stripe) and an admin dashboard.
Zero npm dependencies (Node 22+, built-in SQLite).

## DNS (at your domain registrar)
| Type | Host  | Value             |
|------|-------|-------------------|
| A    | @     | 185.136.150.190   |
| A    | www   | 185.136.150.190   |
| A    | admin | 185.136.150.190   |

Also forward public TCP ports **80** and **443** on the router/firewall to the VM (192.168.100.23).

## HTTPS (after DNS resolves)
    sudo certbot --nginx -d a2z.deals -d www.a2z.deals -d admin.a2z.deals --redirect -m YOU@EMAIL --agree-tos

## Stripe
1. Dashboard > Developers > API keys: put the secret key in `/opt/a2z/.env` as STRIPE_SECRET_KEY.
2. Developers > Webhooks > Add endpoint `https://a2z.deals/stripe/webhook`, events:
   checkout.session.completed, customer.subscription.created, customer.subscription.updated,
   customer.subscription.deleted, invoice.paid. Put the signing secret in STRIPE_WEBHOOK_SECRET.
3. Settings > Billing > Customer portal: enable it.
4. `sudo systemctl restart a2z`. Test first with `sk_test_...` keys and card 4242 4242 4242 4242.

## Operations
- Logs: `sudo journalctl -u a2z -f`   Restart: `sudo systemctl restart a2z`
- Data: `/opt/a2z/data/a2z.db`; nightly backups in `/opt/a2z/data/backups` (14 kept)
- Admin password reset: `cd /opt/a2z && sudo -u a2z node scripts/create-admin.js admin@a2z.deals 'NEW-LONG-PASSWORD'`
- Config: `/opt/a2z/.env` (see `lib/config.js` for every option)
