# Installation Nextcloud Enterprise Edition sur RHEL 9.8 (BDD déportée)

Sep 17, 2026 · @Capitaine

## 0. Vérification des spécifications de la VM

Avant toute installation, valider que la VM respecte le dimensionnement minimum retenu (4 vCPU / 8 Go RAM).

```bash
# CPU : nombre de coeurs
nproc
lscpu | grep -E '^CPU\(s\)|Model name'

# Mémoire vive
free -h

# Espace disque et points de montage
df -h
lsblk

# Version exacte de l'OS
cat /etc/redhat-release
uname -r

# Architecture (64 bits attendu)
uname -m
```

| Ressource | Minimum attendu | Commande de vérification |
| --- | --- | --- |
| CPU | 4 vCPU | `nproc` |
| RAM | 8 Go | `free -h` |
| Disque système | 60 Go | `df -h /` |
| OS | RHEL 9.8, 64 bits | `cat /etc/redhat-release` + `uname -m` |

Si la VM est sous-dimensionnée, ajuster côté hyperviseur (vCPU/RAM à chaud si le pilote le permet, sinon extinction + resize) avant de poursuivre.

## 1. Prérequis

Avant de commencer, réunissez les éléments suivants.

**Machine RHEL**

- RHEL 9.8, abonnement Red Hat Subscription Manager actif (pour les dépôts BaseOS/AppStream)
- Minimum recommandé : 4 vCPU / 8 Go RAM / 60 Go disque système (hors volume de données utilisateurs, à dimensionner selon les volumes SFS attendus)
- Accès root ou sudo
- Un nom de domaine ou enregistrement DNS pointant vers le serveur (ex. `cloud.moncabinet.fr`)

**Base de données déportée**

- Un serveur PostgreSQL (14 à 18) déjà installé sur une machine séparée
- Adresse IP/FQDN, port, et un compte disposant des droits `CREATE DATABASE`/`CREATE USER` (ou une base et un utilisateur déjà provisionnés par l'équipe DBA)
- Le flux réseau TCP 5432 (PostgreSQL) doit être ouvert entre le serveur Nextcloud et le serveur de BDD (pare-feu réseau + firewalld côté BDD)

**Licence Nextcloud Enterprise**

- Un compte client sur le portail Nextcloud GmbH avec les identifiants de subscription (`subscription key`) pour accéder au dépôt `enterprise` et activer l'app `Enterprise Bundle` / `support`

**Rappel de vos décisions d'architecture déjà actées**

- Chiffrement côté serveur en mode **Master Key** (compatible SSO)
- Redis pour le cache mémoire et le verrouillage de fichiers (`file_locking.enabled`)
- ClamAV pour l'analyse antivirus des dépôts
- Dimensionnement de base : 4 vCPU / 8 Go RAM

## 2. Préparation du système RHEL 9.8

```bash
# Mise à jour complète du système
sudo dnf update -y
sudo reboot

# Vérification de l'abonnement et des dépôts
subscription-manager status
sudo dnf repolist

# Utilitaires de base
sudo dnf install -y wget curl tar bzip2 vim policycoreutils-python-utils chrony

# Synchronisation horaire (important pour TOTP/2FA et les jetons de session)
sudo systemctl enable --now chronyd
timedatectl set-timezone Europe/Paris
```

**Firewalld** (le pare-feu local ; le flux vers la BDD distante doit en plus être ouvert au niveau réseau) :

```bash
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

**SELinux** : le laisser en mode `enforcing` (recommandé) — les règles spécifiques à Nextcloud sont posées en section 7. Vérifier l'état :

```bash
getenforce
```

## 3. Apache, PHP 8.3 et modules requis

RHEL 9.8 fournit PHP 8.1 via AppStream, trop ancien pour Nextcloud (8.3 minimum, 8.4 recommandé). On utilise le module **Remi** qui fournit PHP 8.3/8.4 packagé pour RHEL.

```bash
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
```

Activer PHP-FPM et le lier à Apache (mod\_php n'est pas packagé par Remi pour PHP 8.3+, on passe donc en php-fpm) :

```bash
sudo systemctl enable --now php-fpm
sudo dnf install -y mod_php || true   # ignorer si absent : on utilisera proxy_fcgi
```

Sur RHEL, la configuration Apache se trouve dans `/etc/httpd/conf.d/`. Créer `/etc/httpd/conf.d/nextcloud.conf` :

```apache
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
```

```bash
sudo a2enmod rewrite headers env dir mime 2>/dev/null || sudo dnf install -y mod_rewrite 2>/dev/null
sudo systemctl restart httpd php-fpm
```

> Sur RHEL, la plupart des modules Apache (`rewrite`, `headers`, `env`, `dir`, `mime`) sont déjà chargés par défaut avec `httpd` — pas d'équivalent `a2enmod` ; vérifier avec `httpd -M | grep -E 'rewrite|headers|proxy_fcgi'`.

## 4. Base de données déportée

La base tourne sur un serveur séparé : toute la configuration ci-dessous s'exécute **sur le serveur de BDD**, sauf le test de connectivité final.

### Configuration PostgreSQL

```sql
CREATE USER nextcloud WITH PASSWORD 'MOT_DE_PASSE_FORT';
CREATE DATABASE nextcloud OWNER nextcloud ENCODING 'UTF8' TEMPLATE template0;
```

Dans `pg_hba.conf`, autoriser l'IP du serveur Nextcloud, et dans `postgresql.conf` : `listen_addresses = '*'`, puis :

```bash
sudo systemctl restart postgresql
sudo firewall-cmd --permanent --add-port=5432/tcp
sudo firewall-cmd --reload
```

### Test de connectivité (depuis le serveur Nextcloud)

```bash
psql -h <IP_BDD> -U nextcloud -d nextcloud
```

Si la connexion échoue, vérifier dans l'ordre : pare-feu réseau entre les deux VLAN, `firewall-cmd` côté BDD, `listen_addresses`, puis les droits `GRANT`/`pg_hba.conf`.

## 5. Redis (cache et verrouillage de fichiers)

```bash
sudo dnf install -y redis
sudo systemctl enable --now redis
```

Dans `/etc/redis/redis.conf`, sécuriser l'accès local :

```ini
unixsocket /var/run/redis/redis.sock
unixsocketperm 770
requirepass MOT_DE_PASSE_REDIS
```

```bash
sudo usermod -a -G redis apache
sudo systemctl restart redis
```

La déclaration dans `config.php` (mémoire cache **et** verrouillage de fichiers) est faite en section 8 une fois Nextcloud installé.

## 6. Téléchargement et installation de Nextcloud Enterprise Edition

L'archive EE n'est pas sur le dépôt public : elle se télécharge depuis le portail client Nextcloud GmbH avec vos identifiants de subscription, ou via l'URL signée fournie dans votre espace client.

```bash
cd /tmp
# Remplacer par l'URL exacte fournie par votre espace client Nextcloud GmbH
wget "https://portal.nextcloud.com/customer/download/enterprise/nextcloud-enterprise-<version>.tar.bz2"
tar -xjf nextcloud-enterprise-<version>.tar.bz2
sudo mv nextcloud /var/www/html/nextcloud
sudo chown -R apache:apache /var/www/html/nextcloud
sudo chmod -R 750 /var/www/html/nextcloud
```

**Répertoire de données** (à part du webroot, idéalement sur un volume dédié) :

```bash
sudo mkdir -p /srv/nextcloud-data
sudo chown apache:apache /srv/nextcloud-data
```

**Installation en ligne de commande** (`occ`), avec la BDD déportée :

```bash
sudo -u apache php /var/www/html/nextcloud/occ maintenance:install \
  --database "pgsql" \
  --database-host "<IP_ou_FQDN_BDD>:5432" \
  --database-name "nextcloud" \
  --database-user "nextcloud" \
  --database-pass "MOT_DE_PASSE_FORT" \
  --data-dir "/srv/nextcloud-data" \
  --admin-user "admin" \
  --admin-pass "MOT_DE_PASSE_ADMIN"
```

**Application de la clé de subscription Enterprise** :

```bash
sudo -u apache php /var/www/html/nextcloud/occ config:system:set license-key --value="VOTRE_CLE_DE_SOUSCRIPTION"
sudo -u apache php /var/www/html/nextcloud/occ app:enable support
```

Vérifier que le statut d'abonnement est bien reconnu dans **Administration > Aperçu** une fois connecté.

## 7. SELinux, pare-feu et SSL/TLS

### SELinux

```bash
sudo dnf install -y policycoreutils-python-utils

# Contextes sur le webroot et le répertoire de données
sudo semanage fcontext -a -t httpd_sys_rw_content_t "/var/www/html/nextcloud(/.*)?"
sudo semanage fcontext -a -t httpd_sys_rw_content_t "/srv/nextcloud-data(/.*)?"
sudo restorecon -Rv /var/www/html/nextcloud /srv/nextcloud-data

# Autoriser Apache à ouvrir des connexions réseau sortantes (BDD déportée, Redis distant, fédération)
sudo setsebool -P httpd_can_network_connect on
sudo setsebool -P httpd_can_network_connect_db on
```

En cas de blocage inattendu, consulter `/var/log/audit/audit.log` et générer un module dédié avec `audit2allow` plutôt que de désactiver SELinux.

### Pare-feu

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

(le port de la BDD distante a déjà été ouvert côté serveur BDD en section 4 — rien à ouvrir en entrée ici, seulement en sortie, généralement déjà autorisé par défaut sur firewalld).

### SSL/TLS

Avec Let's Encrypt (accès Internet direct au serveur) :

```bash
sudo dnf install -y certbot python3-certbot-apache
sudo certbot --apache -d cloud.moncabinet.fr
```

Si le serveur n'est pas exposé directement sur Internet (cas fréquent pour un partage SFS interne/partenaires), utiliser un certificat émis par votre PKI interne ou un reverse-proxy existant, et forcer `overwrite.protocol => 'https'` dans `config.php` si le TLS est terminé en amont.

## 8. Réglages finaux

### Domaines de confiance et proxy éventuel

```bash
sudo -u apache php /var/www/html/nextcloud/occ config:system:set trusted_domains 1 --value="cloud.moncabinet.fr"
```

### Redis — cache mémoire et verrouillage de fichiers

Dans `/var/www/html/nextcloud/config/config.php` :

```php
'memcache.local' => '\\OC\\Memcache\\APCu',
'memcache.locking' => '\\OC\\Memcache\\Redis',
'memcache.distributed' => '\\OC\\Memcache\\Redis',
'redis' => [
    'host' => '/var/run/redis/redis.sock',
    'port' => 0,
    'password' => 'MOT_DE_PASSE_REDIS',
],
'filelocking.enabled' => true,
```

### Chiffrement — mode Master Key

```bash
sudo -u apache php /var/www/html/nextcloud/occ app:enable encryption
sudo -u apache php /var/www/html/nextcloud/occ encryption:enable
sudo -u apache php /var/www/html/nextcloud/occ encryption:select-encryption-type masterkey
sudo -u apache php /var/www/html/nextcloud/occ encryption:encrypt-all
```

### ClamAV (antivirus des dépôts)

```bash
sudo dnf install -y clamav clamav-update clamd
sudo freshclam
sudo systemctl enable --now clamd@scan
```

Installer l'app **Antivirus for files** depuis l'App Store Nextcloud puis, dans **Administration > Sécurité**, pointer le mode « Démon Clam AV » vers le socket `/run/clamd.scan/clamd.sock`.

### Tâches planifiées (cron)

```bash
sudo -u apache php /var/www/html/nextcloud/occ background:cron
(sudo crontab -u apache -l 2>/dev/null; echo "*/5 * * * * php -f /var/www/html/nextcloud/cron.php") | sudo crontab -u apache -
```

### PHP — opcache et limites

Dans `/etc/php.d/10-opcache.ini` (ou équivalent Remi) :

```ini
opcache.enable=1
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=10000
opcache.memory_consumption=256
opcache.save_comments=1
opcache.revalidate_freq=60
```

Dans `php.ini` : `memory_limit = 512M`, `upload_max_filesize`/`post_max_size` selon la taille des dépôts SFS attendue (ex. `10G` pour de gros transferts partenaires).

```bash
sudo systemctl restart php-fpm httpd
```

## 9. Cahier de recette (vérifications post-installation)

| Test | Commande / action | Résultat attendu |
| --- | --- | --- |
| Diagnostic global | `occ check` puis Administration > Aperçu | Aucune alerte critique |
| Connexion BDD déportée | Connexion web + `occ db:...` | Pas d'erreur, latence acceptable |
| Redis actif | `occ config:list system \| grep -i redis` puis upload concurrent de 2 sessions | Pas de conflit de verrou fichier |
| Chiffrement Master Key | `occ encryption:status` | `enabled: true`, `masterKeyEnabled: true` |
| ClamAV | Uploader un fichier de test EICAR | Fichier rejeté/mis en quarantaine |
| Cron | Administration > Réglages de base | Dernière exécution < 15 min |
| SSL | `curl -vI https://cloud.moncabinet.fr` | Certificat valide, HTTP 200 |
| SELinux | `sudo ausearch -m avc -ts recent` | Aucun déni pertinent |
| Upload gros fichier | Upload > 1 Go via navigateur ou client desktop | Succès sans timeout |
| Migration utilisateurs LDAP/locaux | À planifier séparément selon la stratégie retenue | — |

> La ligne « Migration utilisateurs » reste ouverte : elle dépend du choix (comptes locaux vs LDAP) évoqué précédemment et n'est pas couverte par ce tutoriel d'installation.
