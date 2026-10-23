#!/bin/bash
# certbot --manual-auth-hook: publishes the TXT value for the user to add, then waits until it is visible in public DNS.
echo "_acme-challenge.${CERTBOT_DOMAIN}  TXT  ${CERTBOT_VALIDATION}" >> /tmp/acme-txt-records.txt
for i in $(seq 1 180); do
  if node -e '
    const {Resolver}=require("dns").promises; const r=new Resolver(); r.setServers(["8.8.8.8"]);
    r.resolveTxt("_acme-challenge."+process.env.CERTBOT_DOMAIN).then(a=>process.exit(a.flat().includes(process.env.CERTBOT_VALIDATION)?0:1)).catch(()=>process.exit(1))'; then
    sleep 30; exit 0
  fi
  sleep 10
done
exit 1
