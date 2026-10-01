Installation Nextcloud Enterprise Edition sur RHEL 9.8
Document : Installation Nextcloud Enterprise Edition sur RHEL 9.8 (BDD PostgreSQL locale) Rédigé le 17/09/2026 par Capitaine — mis à jour le 01/10/2026 (installation à partir de l'archive .zip déposée sur la VM).
0. Vérification des spécifications de la VM
Avant toute installation, valider que la VM respecte le dimensionnement retenu : Nextcloud, PHP-FPM, Redis et PostgreSQL tournent sur la même machine, pour 10 à 20 utilisateurs simultanés au maximum.
Contrôles de la VM
# CPU : nombre de coeurs
nproc
lscpu | grep -E '^CPU\(s\)|Model name'

# Mémoire vive
free -h

# Espace disque et points de montage
df -h
lsblk

# Volumes dédiés (après préparation, cf. sections 4 et 10)
findmnt /var/lib/pgsql
findmnt /srv/backup

# Version exacte de l'OS
cat /etc/redhat-release
uname -r

# Architecture (64 bits attendu)
uname -m
Ressource
Minimum attendu
Commande de vérification
CPU
4 vCPU
nproc
RAM
8 Go
free -h
Disque système
60 Go
df -h /
Volume PostgreSQL
Volume SSD dédié monté sur /var/lib/pgsql (≥ 20 Go)
findmnt /var/lib/pgsql
Volume sauvegardes BDD
Montage dédié, idéalement hors VM (NFS, cible de backup)
findmnt /srv/backup
OS
RHEL 9.8, 64 bits
cat /etc/redhat-release et uname -m

Budget mémoire estimé : OS ≈ 1 Go, PHP-FPM ≈ 2 Go, PostgreSQL ≈ 1,2 Go, Redis ≈ 0,2 Go, soit environ 4,5 Go ; le reste sert de cache disque. Si la VM swappe lors du test « Mémoire sous charge » de la recette, passer à 10 ou 12 Go côté hyperviseur (à chaud si le pilote le permet, sinon extinction + resize).
1. Prérequis
Avant de commencer, réunir les éléments suivants.
Machine RHEL
RHEL 9.8, abonnement Red Hat Subscription Manager actif (pour les dépôts BaseOS/AppStream)
Dimensionnement : 4 vCPU / 8 Go RAM / 60 Go disque système, un volume SSD dédié à PostgreSQL, et un volume de données utilisateurs dimensionné selon les volumes SFS attendus
Accès root ou sudo
Un nom de domaine ou enregistrement DNS pointant vers le serveur (ex. cloud.moncabinet.fr)
Base de données PostgreSQL locale
PostgreSQL installé sur la VM Nextcloud elle-même, depuis les dépôts AppStream RHEL (section 4) : plus de serveur BDD séparé, plus de flux réseau 5432 à demander
Un disque dédié présenté à la VM avant l'installation, pour /var/lib/pgsql
Un emplacement de sauvegarde, idéalement hors de la VM : l'exploitation de la base (sauvegardes, mises à jour, supervision) revient désormais à l'équipe qui opère Nextcloud
Licence Nextcloud Enterprise
Un compte client sur le portail Nextcloud GmbH avec les identifiants de subscription (subscription key), pour télécharger l'archive Enterprise et activer l'app support
L'archive nextcloud-enterprise-<version>.zip téléchargée depuis le portail sur le poste d'administration (cf. section 6)
Rappel des décisions d'architecture déjà actées
Chiffrement côté serveur en mode Master Key (compatible SSO)
Redis pour le cache mémoire et le verrouillage de fichiers
PostgreSQL en local sur la VM, en écoute sur localhost uniquement
Dimensionnement : 4 vCPU / 8 Go RAM pour 10 à 20 utilisateurs simultanés, plus un volume PostgreSQL dédié
Pas d'antivirus sur les dépôts (ClamAV retiré du périmètre)
HTTPS obligatoire, certificat installé directement sur Apache (section 8)
2. Préparation du système RHEL 9.8
Mise à jour et utilitaires
# Mise à jour complète du système
sudo dnf update -y
sudo reboot

# Vérification de l'abonnement et des dépôts
subscription-manager status
sudo dnf repolist

# Utilitaires de base
sudo dnf install -y wget curl tar bzip2 unzip vim policycoreutils-python-utils chrony

# Synchronisation horaire (important pour TOTP/2FA et les jetons de session)
sudo systemctl enable --now chronyd
timedatectl set-timezone Europe/Paris
Firewalld (pare-feu local ; la BDD étant locale, aucun port PostgreSQL n'est à ouvrir) :
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
SELinux : le laisser en mode enforcing (recommandé) ; les règles spécifiques à Nextcloud sont posées en section 7. Vérifier l'état :
getenforce
3. Apache, PHP 8.3 et modules requis
RHEL 9.8 fournit PHP 8.1 via AppStream, trop ancien pour Nextcloud (8.3 minimum, 8.4 recommandé). On utilise le dépôt Remi, qui fournit PHP 8.3/8.4 packagé pour RHEL.
Apache et PHP
# Apache
sudo dnf install -y httpd mod_ssl
sudo systemctl enable --now httpd

# Dépôt Remi (PHP récent)
sudo dnf install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-9.noarch.rpm
sudo dnf install -y https://rpms.remirepo.net/enterprise/remi-release-9.rpm
sudo dnf module reset php -y
sudo dnf module enable php:remi-8.3 -y

# PHP + modules requis par Nextcloud
sudo dnf install -y php php-cli php-fpm php-pgsql php-gd php-mbstring \
  php-intl php-bcmath php-gmp php-curl php-xml php-zip php-opcache php-apcu \
  php-redis php-ldap php-imagick php-pecl-smbclient
Activer PHP-FPM et le lier à Apache (mod_php n'est pas packagé par Remi pour PHP 8.3+, on passe donc par php-fpm) :
sudo systemctl enable --now php-fpm
sudo dnf install -y mod_php || true   # ignorer si absent : on utilisera proxy_fcgi
Sur RHEL, la configuration Apache se trouve dans /etc/httpd/conf.d/. Créer /etc/httpd/conf.d/nextcloud.conf :
/etc/httpd/conf.d/nextcloud.conf
<VirtualHost *:80>
  ServerName cloud.moncabinet.fr
  DocumentRoot /var/www/html/nextcloud/

  <Directory /var/www/html/nextcloud/>
    Require all granted
    AllowOverride All
    Options FollowSymLinks MultiViews
    <IfModule mod_dav.c>
      Dav off
    </IfModule>
  </Directory>

  <FilesMatch \.php$>
    SetHandler "proxy:unix:/run/php-fpm/www.sock|fcgi://localhost"
  </FilesMatch>
</VirtualHost>
sudo a2enmod rewrite headers env dir mime 2>/dev/null || sudo dnf install -y mod_rewrite 2>/dev/null
sudo systemctl restart httpd php-fpm
Remarque : Sur RHEL, la plupart des modules Apache (rewrite, headers, env, dir, mime) sont déjà chargés par défaut avec httpd ; il n'y a pas d'équivalent à a2enmod. Vérifier avec : httpd -M | grep -E 'rewrite|headers|proxy_fcgi'
4. Base de données PostgreSQL locale
La base tourne sur la même VM que Nextcloud et n'écoute que sur localhost : aucun port à ouvrir, aucun flux réseau à demander. Toutes les commandes ci-dessous s'exécutent sur la VM Nextcloud.
Volume dédié pour les données PostgreSQL
À faire avant l'installation du paquet, pour que /var/lib/pgsql soit sur son propre disque (isolation des I/O et de l'espace disque vis-à-vis des fichiers utilisateurs).
# Exemple avec un disque /dev/sdb dédié : adapter au nom réel vu dans lsblk
sudo pvcreate /dev/sdb
sudo vgcreate vg_pgsql /dev/sdb
sudo lvcreate -l 100%FREE -n lv_pgsql vg_pgsql
sudo mkfs.xfs /dev/vg_pgsql/lv_pgsql

sudo mkdir -p /var/lib/pgsql
echo '/dev/vg_pgsql/lv_pgsql  /var/lib/pgsql  xfs  defaults,noatime  0 0' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount /var/lib/pgsql
Installation de PostgreSQL
# Versions disponibles dans AppStream
sudo dnf module list postgresql

# Activer la 16 (maintenue par Red Hat, supportée par Nextcloud)
sudo dnf module enable -y postgresql:16
sudo dnf install -y postgresql-server postgresql-contrib

# Droits et contexte SELinux sur le volume monté
sudo chown postgres:postgres /var/lib/pgsql
sudo chmod 700 /var/lib/pgsql
sudo restorecon -Rv /var/lib/pgsql

# Initialisation du cluster et démarrage
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
Base et utilisateur applicatif
sudo -u postgres psql <<'EOF'
CREATE USER nextcloud WITH PASSWORD 'MOT_DE_PASSE_FORT';
CREATE DATABASE nextcloud OWNER nextcloud ENCODING 'UTF8' TEMPLATE template0;
EOF
Écoute et authentification
Dans /var/lib/pgsql/data/postgresql.conf :
listen_addresses = 'localhost'
password_encryption = scram-sha-256
Dans /var/lib/pgsql/data/pg_hba.conf, ajouter ces lignes au-dessus des règles par défaut (la première règle qui correspond l'emporte, et RHEL met ident par défaut sur 127.0.0.1) :
# TYPE  DATABASE   USER       ADDRESS        METHOD
host    nextcloud  nextcloud  127.0.0.1/32   scram-sha-256
host    nextcloud  nextcloud  ::1/128        scram-sha-256
Réglages mémoire (VM 8 Go)
Toujours dans postgresql.conf :
shared_buffers = 1GB
effective_cache_size = 3GB
work_mem = 8MB
maintenance_work_mem = 256MB
max_connections = 50
wal_buffers = 16MB
checkpoint_completion_target = 0.9
random_page_cost = 1.1            # volume SSD
effective_io_concurrency = 200    # volume SSD
Valeurs calibrées pour 10 à 20 utilisateurs simultanés. max_connections doit rester supérieur à pm.max_children de PHP-FPM (section 9), avec une marge pour le cron et les commandes occ. Si la VM passe à 12 Go, monter à shared_buffers = 1536MB et effective_cache_size = 5GB.
Application et test
sudo systemctl restart postgresql

# Doit écouter uniquement sur 127.0.0.1 et ::1
sudo ss -tlnp 'sport = :5432'

# Test d'authentification du compte applicatif (mot de passe demandé)
psql -h 127.0.0.1 -U nextcloud -d nextcloud -c 'SELECT version();'
Ne pas ajouter de règle firewalld pour le port 5432 : il n'a aucune raison d'être exposé. Si la connexion échoue, vérifier dans l'ordre : service démarré (systemctl status postgresql), ordre des lignes dans pg_hba.conf, puis le mot de passe (ALTER USER nextcloud WITH PASSWORD ... pour le réinitialiser).
5. Redis (cache et verrouillage de fichiers)
sudo dnf install -y redis
sudo systemctl enable --now redis
Dans /etc/redis/redis.conf, sécuriser l'accès local :
unixsocket /var/run/redis/redis.sock
unixsocketperm 770
requirepass MOT_DE_PASSE_REDIS
sudo usermod -a -G redis apache
sudo systemctl restart redis
La déclaration dans config.php (mémoire cache et verrouillage de fichiers) est faite en section 9, une fois Nextcloud installé.
6. Téléchargement et installation de Nextcloud Enterprise Edition
L'archive EE n'est pas sur le dépôt public : l'archive .zip se télécharge depuis le portail client Nextcloud GmbH (identifiants de subscription), sur le poste d'administration, puis elle est déposée sur la VM. La VM n'a donc besoin d'aucun accès sortant vers les serveurs Nextcloud pour l'installation.
6.1 Sur le poste d'administration
Télécharger nextcloud-enterprise-<version>.zip depuis le portail, et relever l'empreinte SHA-256 publiée à côté si elle est fournie.
# macOS : calcul de l'empreinte, à comparer avec celle du portail
shasum -a 256 nextcloud-enterprise-<version>.zip
6.2 Dépôt sur la VM
Copier le zip dans /tmp de la VM par le canal de transfert autorisé (SFTP/SCP via CyberArk, ou outil de transfert habituel). Exemple en SCP direct :
scp nextcloud-enterprise-<version>.zip <compte>@<vm-nextcloud>:/tmp/
6.3 Sur la VM : contrôle, décompression, mise en place
sudo dnf install -y unzip
cd /tmp

# Même empreinte que sur le poste : le fichier n'a pas été altéré pendant le transfert
sha256sum nextcloud-enterprise-<version>.zip

# L'archive doit contenir un dossier racine nextcloud/
unzip -l nextcloud-enterprise-<version>.zip | head

unzip -q nextcloud-enterprise-<version>.zip
sudo mv nextcloud /var/www/html/nextcloud
sudo chown -R apache:apache /var/www/html/nextcloud
sudo chmod -R 750 /var/www/html/nextcloud

# Ménage
rm -f /tmp/nextcloud-enterprise-<version>.zip
Remarque : Le dossier déplacé depuis /tmp garde un contexte SELinux user_tmp_t : c'est normal à ce stade, le restorecon de la section 7 le corrige. Tant que la section 7 n'est pas faite, Apache peut renvoyer des erreurs 403 sur le webroot.
6.4 Répertoire de données
À part du webroot, idéalement sur un volume dédié :
sudo mkdir -p /srv/nextcloud-data
sudo chown apache:apache /srv/nextcloud-data
6.5 Installation en ligne de commande (occ)
Avec la BDD locale :
sudo -u apache php /var/www/html/nextcloud/occ maintenance:install \
  --database "pgsql" \
  --database-host "127.0.0.1:5432" \
  --database-name "nextcloud" \
  --database-user "nextcloud" \
  --database-pass "MOT_DE_PASSE_FORT" \
  --data-dir "/srv/nextcloud-data" \
  --admin-user "admin" \
  --admin-pass "MOT_DE_PASSE_ADMIN"

# Index et réparations recommandés après l'installation
sudo -u apache php /var/www/html/nextcloud/occ db:add-missing-indices
sudo -u apache php /var/www/html/nextcloud/occ maintenance:repair --include-expensive
Info : On passe par TCP sur 127.0.0.1 plutôt que par socket Unix : la règle pg_hba.conf reste simple, SELinux n'a rien de plus à autoriser, et le surcoût est négligeable en local.
6.6 Application de la clé de subscription Enterprise
sudo -u apache php /var/www/html/nextcloud/occ config:system:set license-key --value="VOTRE_CLE_DE_SOUSCRIPTION"
sudo -u apache php /var/www/html/nextcloud/occ app:enable support
Vérifier que le statut d'abonnement est bien reconnu dans Administration > Aperçu une fois connecté.
7. SELinux et pare-feu
SELinux
sudo dnf install -y policycoreutils-python-utils

# Contextes sur le webroot et le répertoire de données
sudo semanage fcontext -a -t httpd_sys_rw_content_t "/var/www/html/nextcloud(/.*)?"
sudo semanage fcontext -a -t httpd_sys_rw_content_t "/srv/nextcloud-data(/.*)?"
sudo restorecon -Rv /var/www/html/nextcloud /srv/nextcloud-data

# Apache -> PostgreSQL local en TCP (127.0.0.1:5432)
sudo setsebool -P httpd_can_network_connect_db on

# Apache -> connexions sortantes (App Store, fédération, SMTP)
sudo setsebool -P httpd_can_network_connect on

# Contrôle : le volume PostgreSQL garde son contexte postgresql_db_t
ls -Zd /var/lib/pgsql/data
En cas de blocage inattendu, consulter /var/log/audit/audit.log et générer un module dédié avec audit2allow plutôt que de désactiver SELinux.
Pare-feu
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
Seuls HTTP et HTTPS sont exposés. PostgreSQL n'écoute que sur localhost : aucun port BDD à ouvrir, ni en entrée ni au niveau du pare-feu réseau.
8. Certificat HTTPS
HTTPS est indispensable : les clients desktop et mobiles, les cookies de session et les partages avec les partenaires en dépendent. Le cas nominal ci-dessous est un certificat émis par la PKI interne ou une autorité commerciale, installé directement sur Apache. Deux variantes suivent : Let's Encrypt, et TLS terminé sur un reverse-proxy existant.
Les fichiers sont rangés dans /etc/pki/tls/, qui porte déjà le bon contexte SELinux (cert_t) : rien à ajouter côté SELinux tant qu'on reste dans cette arborescence.
Fichier
Emplacement
Clé privée
/etc/pki/tls/private/cloud.moncabinet.fr.key
Demande de certificat (CSR)
/etc/pki/tls/private/cloud.moncabinet.fr.csr
Certificat serveur
/etc/pki/tls/certs/cloud.moncabinet.fr.crt
Chaîne intermédiaire
/etc/pki/tls/certs/cloud.moncabinet.fr-chain.crt
Certificat + chaîne (utilisé par Apache)
/etc/pki/tls/certs/cloud.moncabinet.fr-fullchain.crt

8.1 Générer la clé privée et la CSR
sudo openssl req -new -newkey rsa:3072 -nodes \
  -keyout /etc/pki/tls/private/cloud.moncabinet.fr.key \
  -out /etc/pki/tls/private/cloud.moncabinet.fr.csr \
  -subj "/C=FR/O=MonCabinet/CN=cloud.moncabinet.fr" \
  -addext "subjectAltName=DNS:cloud.moncabinet.fr"

sudo chmod 600 /etc/pki/tls/private/cloud.moncabinet.fr.key

# Contrôle : le SAN doit contenir le FQDN (les navigateurs ignorent le CN seul)
sudo openssl req -in /etc/pki/tls/private/cloud.moncabinet.fr.csr -noout -text | grep -A1 'Subject Alternative Name'
Transmettre le fichier .csr (jamais la clé) à l'équipe PKI ou à l'autorité de certification. Demander en retour le certificat serveur et la chaîne intermédiaire, au format PEM.
8.2 Installer le certificat reçu
Si l'autorité fournit un fichier .pfx / .p12, en extraire d'abord les éléments :
openssl pkcs12 -in certificat.pfx -clcerts -nokeys -out cloud.moncabinet.fr.crt
openssl pkcs12 -in certificat.pfx -cacerts -nokeys -out cloud.moncabinet.fr-chain.crt
# Uniquement si la clé a été générée par l'autorité et non par la CSR ci-dessus
openssl pkcs12 -in certificat.pfx -nocerts -nodes -out cloud.moncabinet.fr.key
Puis installer et vérifier :
sudo cp cloud.moncabinet.fr.crt cloud.moncabinet.fr-chain.crt /etc/pki/tls/certs/
cd /etc/pki/tls/certs
sudo sh -c 'cat cloud.moncabinet.fr.crt cloud.moncabinet.fr-chain.crt > cloud.moncabinet.fr-fullchain.crt'
sudo chmod 644 cloud.moncabinet.fr*.crt
sudo restorecon -Rv /etc/pki/tls

# La clé et le certificat doivent correspondre (les deux empreintes doivent être identiques)
sudo openssl x509 -in cloud.moncabinet.fr.crt -noout -pubkey | sha256sum
sudo openssl pkey -in /etc/pki/tls/private/cloud.moncabinet.fr.key -pubout | sha256sum

# La chaîne doit valider le certificat
openssl verify -untrusted cloud.moncabinet.fr-chain.crt cloud.moncabinet.fr.crt

# Dates de validité et SAN
openssl x509 -in cloud.moncabinet.fr.crt -noout -dates -ext subjectAltName
Remarque : Avec une PKI interne, openssl verify ne répond OK que si la CA racine est connue du serveur : la déposer dans /etc/pki/ca-trust/source/anchors/ puis lancer sudo update-ca-trust. Les postes des utilisateurs et des partenaires doivent aussi faire confiance à cette racine ; sinon, privilégier un certificat d'une autorité publique pour un service ouvert aux partenaires externes.
8.3 Configuration Apache en HTTPS
Remplacer /etc/httpd/conf.d/nextcloud.conf (créé en section 3) par :
/etc/httpd/conf.d/nextcloud.conf
<VirtualHost *:80>
  ServerName cloud.moncabinet.fr
  RewriteEngine On
  RewriteRule ^/?(.*) https://%{SERVER_NAME}/$1 [R=301,L]
</VirtualHost>

<VirtualHost *:443>
  ServerName cloud.moncabinet.fr
  DocumentRoot /var/www/html/nextcloud/

  SSLEngine on
  SSLCertificateFile    /etc/pki/tls/certs/cloud.moncabinet.fr-fullchain.crt
  SSLCertificateKeyFile /etc/pki/tls/private/cloud.moncabinet.fr.key

  # Recommandé par Nextcloud (6 mois) ; à n'activer qu'une fois le certificat validé
  Header always set Strict-Transport-Security "max-age=15552000; includeSubDomains"

  <Directory /var/www/html/nextcloud/>
    Require all granted
    AllowOverride All
    Options FollowSymLinks MultiViews
    <IfModule mod_dav.c>
      Dav off
    </IfModule>
  </Directory>

  <FilesMatch \.php$>
    SetHandler "proxy:unix:/run/php-fpm/www.sock|fcgi://localhost"
  </FilesMatch>
</VirtualHost>
sudo apachectl configtest
sudo systemctl reload httpd
Pas besoin de fixer SSLProtocol ni SSLCipherSuite : RHEL applique la politique cryptographique système (update-crypto-policies --show renvoie DEFAULT, soit TLS 1.2 et 1.3 uniquement). Le vhost _default_:443 livré dans ssl.conf peut rester : Apache sélectionne le bon vhost par SNI grâce au ServerName.
8.4 Déclarer l'URL HTTPS dans Nextcloud
sudo -u apache php /var/www/html/nextcloud/occ config:system:set overwrite.cli.url --value="https://cloud.moncabinet.fr"
Cette valeur sert aux liens générés hors requête web (notifications, cron, liens de partage envoyés par e-mail).
8.5 Variante : Let's Encrypt
Uniquement si le serveur est joignable depuis Internet sur le port 80 avec un DNS public (validation HTTP-01). À la place des étapes 8.1 à 8.3 :
# certbot vient d'EPEL, déjà ajouté en section 3
sudo dnf install -y certbot python3-certbot-apache
sudo certbot --apache -d cloud.moncabinet.fr --redirect
Le renouvellement se fait à la main : les certificats Let's Encrypt ne durent que 90 jours, relancer sudo certbot renew avant chaque échéance.
8.6 Variante : TLS terminé sur un reverse-proxy
Si un reverse-proxy ou un load-balancer existant porte le certificat, Apache reste en HTTP sur le réseau interne et Nextcloud doit connaître le proxy :
OCC="sudo -u apache php /var/www/html/nextcloud/occ"
$OCC config:system:set trusted_proxies 0 --value="<IP_DU_PROXY>"
$OCC config:system:set overwriteprotocol --value="https"
$OCC config:system:set overwrite.cli.url --value="https://cloud.moncabinet.fr"
$OCC config:system:set forwarded_for_headers 0 --value="HTTP_X_FORWARDED_FOR"
L'en-tête HSTS se pose alors sur le proxy, pas sur Apache.
8.7 Renouvellement et surveillance de l'expiration
Un certificat PKI ou commercial dure en général un an et ne se renouvelle pas tout seul. Script d'alerte à 30 jours, qui écrit dans le journal système (à raccorder à la supervision) :
sudo tee /usr/local/bin/check-cert-expiry.sh > /dev/null <<'EOF'
#!/bin/bash
CERT=/etc/pki/tls/certs/cloud.moncabinet.fr.crt
SEUIL_JOURS=30
if ! openssl x509 -in "$CERT" -noout -checkend $((SEUIL_JOURS * 86400)) > /dev/null; then
  logger -t cert-expiry -p user.warning \
    "Certificat $CERT expire dans moins de $SEUIL_JOURS jours ($(openssl x509 -in "$CERT" -noout -enddate))"
fi
EOF
sudo chmod 755 /usr/local/bin/check-cert-expiry.sh
echo '0 8 * * * root /usr/local/bin/check-cert-expiry.sh' | sudo tee /etc/cron.d/check-cert-expiry
Procédure de renouvellement, sans interruption de service : générer une nouvelle CSR (8.1), installer le nouveau certificat et reconstruire le fullchain (8.2), puis apachectl configtest et systemctl reload httpd.
9. Réglages finaux
Domaines de confiance
sudo -u apache php /var/www/html/nextcloud/occ config:system:set trusted_domains 1 --value="cloud.moncabinet.fr"
Redis : cache mémoire et verrouillage de fichiers
Dans /var/www/html/nextcloud/config/config.php :
'memcache.local' => '\\OC\\Memcache\\APCu',
'memcache.locking' => '\\OC\\Memcache\\Redis',
'memcache.distributed' => '\\OC\\Memcache\\Redis',
'redis' => [
    'host' => '/var/run/redis/redis.sock',
    'port' => 0,
    'password' => 'MOT_DE_PASSE_REDIS',
],
'filelocking.enabled' => true,
Chiffrement : mode Master Key
sudo -u apache php /var/www/html/nextcloud/occ app:enable encryption
sudo -u apache php /var/www/html/nextcloud/occ encryption:enable
sudo -u apache php /var/www/html/nextcloud/occ encryption:select-encryption-type masterkey
sudo -u apache php /var/www/html/nextcloud/occ encryption:encrypt-all
Tâches planifiées (cron)
sudo -u apache php /var/www/html/nextcloud/occ background:cron
(sudo crontab -u apache -l 2>/dev/null; echo "*/5 * * * * php -f /var/www/html/nextcloud/cron.php") | sudo crontab -u apache -
PHP : opcache et limites
Dans /etc/php.d/10-opcache.ini (ou équivalent Remi) :
opcache.enable=1
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=10000
opcache.memory_consumption=256
opcache.save_comments=1
opcache.revalidate_freq=60
Dans php.ini : memory_limit = 512M, upload_max_filesize et post_max_size selon la taille des dépôts SFS attendue (ex. 10G pour de gros transferts partenaires).
sudo systemctl restart php-fpm httpd
PHP-FPM : taille du pool
Avec PostgreSQL sur la même VM, le pool PHP-FPM doit être borné pour ne pas affamer la base. Dans /etc/php-fpm.d/www.conf :
pm = dynamic
pm.max_children = 25
pm.start_servers = 5
pm.min_spare_servers = 3
pm.max_spare_servers = 10
pm.max_requests = 500
Compter environ 60 à 80 Mo par processus : 25 processus représentent 1,5 à 2 Go, largement de quoi servir 10 à 20 utilisateurs simultanés. Garder pm.max_children sous le max_connections de PostgreSQL (50).
sudo systemctl restart php-fpm
10. Sauvegarde et exploitation de la base locale
La base n'est plus sauvegardée par une équipe BDD : c'est à mettre en place dès l'installation. Une sauvegarde exploitable comprend trois éléments cohérents entre eux : le dump PostgreSQL, config.php, et le répertoire de données.
Attention : En mode Master Key, perdre config.php (secret, passwordsalt) ou les clés sous /srv/nextcloud-data/files_encryption rend les fichiers illisibles.
Script de sauvegarde
/usr/local/bin/nextcloud-db-backup.sh
#!/bin/bash
set -euo pipefail

BACKUP_DIR=/srv/backup/nextcloud-db
RETENTION_DAYS=14
STAMP=$(date +%Y%m%d-%H%M)

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Dump au format custom (compressé, restauration sélective possible)
runuser -u postgres -- pg_dump -Fc nextcloud > "$BACKUP_DIR/nextcloud-$STAMP.dump"

# config.php (secret + passwordsalt indispensables au déchiffrement)
cp /var/www/html/nextcloud/config/config.php "$BACKUP_DIR/config-$STAMP.php"
chmod 600 "$BACKUP_DIR"/*-"$STAMP".*

# Rétention
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete
sudo chmod 700 /usr/local/bin/nextcloud-db-backup.sh
echo '30 1 * * * root /usr/local/bin/nextcloud-db-backup.sh >> /var/log/nextcloud-db-backup.log 2>&1' | sudo tee /etc/cron.d/nextcloud-db-backup
/srv/backup doit idéalement être un montage hors VM (NFS, cible de l'outil de sauvegarde), sinon une perte de la VM emporte la base et ses sauvegardes. Si les fichiers utilisateurs sont sauvegardés par snapshot, encadrer dump + snapshot par occ maintenance:mode --on / --off pour garantir la cohérence entre base et fichiers.
Restauration (à tester en recette, jamais directement en production)
sudo -u apache php /var/www/html/nextcloud/occ maintenance:mode --on

sudo -u postgres dropdb nextcloud
sudo -u postgres createdb -O nextcloud -E UTF8 -T template0 nextcloud
sudo sh -c 'runuser -u postgres -- pg_restore -d nextcloud --no-owner --role=nextcloud < /srv/backup/nextcloud-db/nextcloud-AAAAMMJJ-HHMM.dump'

sudo -u apache php /var/www/html/nextcloud/occ maintenance:mode --off
sudo -u apache php /var/www/html/nextcloud/occ maintenance:data-fingerprint
Maintenance courante
Mises à jour : les versions mineures de PostgreSQL arrivent avec dnf update et s'intègrent au cycle de patching de la VM (redémarrage du service à prévoir). Un changement de version majeure (16 vers 17…) nécessite un pg_dump/pg_restore ou pg_upgrade, à planifier comme une opération à part.
Supervision : surveiller au minimum l'espace libre de /var/lib/pgsql et de /srv/backup, l'état du service postgresql, et le log /var/log/nextcloud-db-backup.log.
Autovacuum : actif par défaut, rien à régler au départ ; vérifier ponctuellement les grosses tables (oc_filecache, oc_activity) avec la requête ci-dessous.
SELECT relname, last_autovacuum FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;
11. Cahier de recette (vérifications post-installation)
Test
Commande / action
Résultat attendu
Statut
Diagnostic global
occ check puis Administration > Aperçu
Aucune alerte critique (dont aucune alerte HTTPS/HSTS)


BDD locale utilisée
occ config:system:get dbhost
127.0.0.1:5432


PostgreSQL non exposé
ss -tlnp 'sport = :5432' et firewall-cmd --list-all
Écoute sur 127.0.0.1 / ::1 uniquement, 5432 absent de firewalld


Réglages PostgreSQL appliqués
sudo -u postgres psql -c 'SHOW shared_buffers;'
1GB


Index BDD
occ db:add-missing-indices
Aucun index manquant


Mémoire sous charge
free -h pendant un upload > 1 Go avec plusieurs sessions ouvertes
Pas de swap significatif, pas d'OOM dans journalctl -k


Redis actif
occ config:system:get memcache.locking puis upload concurrent de 2 sessions
Redis déclaré, pas de conflit de verrou fichier


Chiffrement Master Key
occ encryption:status
enabled: true, masterKeyEnabled: true


Cron
Administration > Réglages de base
Dernière exécution < 15 min


Sauvegarde BDD
Lancer nextcloud-db-backup.sh à la main
Dump et config.php présents dans /srv/backup, taille > 0


Restauration BDD
Procédure section 10 sur l'environnement de recette
Nextcloud fonctionnel, fichiers chiffrés lisibles


HTTPS
curl -vI https://cloud.moncabinet.fr depuis un poste utilisateur
Certificat valide sans avertissement, HTTP 200


Redirection HTTP
curl -I http://cloud.moncabinet.fr
301 vers https://


Chaîne de certificats
openssl s_client -connect cloud.moncabinet.fr:443 -servername cloud.moncabinet.fr < /dev/null
Chaîne complète envoyée, Verify return code: 0 (ok)


HSTS
curl -sI https://cloud.moncabinet.fr
En-tête Strict-Transport-Security présent


Alerte d'expiration
Lancer check-cert-expiry.sh avec SEUIL_JOURS=400
Message cert-expiry visible dans journalctl -t cert-expiry


Accès partenaire externe
Ouvrir un lien de partage depuis un poste hors du SI
Page chargée sans avertissement de certificat


SELinux
sudo ausearch -m avc -ts recent
Aucun déni pertinent (httpd ni postgresql)


Upload gros fichier
Upload > 1 Go via navigateur ou client desktop
Succès sans timeout


Migration utilisateurs LDAP/locaux
À planifier séparément selon la stratégie retenue
—



Info : La ligne « Migration utilisateurs » reste ouverte : elle dépend du choix (comptes locaux ou LDAP) et n'est pas couverte par ce tutoriel d'installation.
