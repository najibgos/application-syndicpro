# 🏢 SyndicPro - Application de Gestion de Copropriété

Application de gestion d'immeuble (syndic) permettant aux propriétaires de consulter l'état financier et les détails de dépenses, et au syndic de gérer les cotisations, dépenses et comptes.

Montants en MAD (Dirham marocain).

## 🚀 Déploiement Gratuit sur Vercel

### Étape 1 : Créer un compte GitHub
1. Allez sur [github.com](https://github.com) → Sign up
2. Créez un nouveau repository (ex: `syndic-immeuble`)

### Étape 2 : Pousser le code sur GitHub
```bash
# Dans le dossier du projet
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/VOTRE-USER/syndic-immeuble.git
git push -u origin main
```

### Étape 3 : Créer une base PostgreSQL gratuite (Neon)
1. Allez sur [neon.tech](https://neon.tech) → Sign up (gratuit)
2. Créez un nouveau projet
3. Copiez la **connection string** (format: `postgresql://...neon.tech/neondb?sslmode=require`)

### Étape 4 : Déployer sur Vercel
1. Allez sur [vercel.com](https://vercel.com) → Sign up with GitHub
2. Cliquez **"Add New Project"**
3. Importez votre repository `syndic-immeuble`
4. Configurez les variables d'environnement :
   - `DATABASE_URL` = votre connection string Neon
   - `JWT_SECRET` = une chaîne aléatoire (ex: `my-super-secret-key-2024`)
5. Cliquez **"Deploy"** 🎉

### Étape 5 : Synchroniser le schéma de la base
```bash
npx prisma db push
```
(à exécuter une fois avec `DATABASE_URL` pointant vers votre base Neon)

### Étape 6 : Initialiser les données
Après le déploiement, visitez :
```
https://VOTRE-APP.vercel.app/api/seed
```
(Envoyez une requête POST avec Postman ou curl)
```bash
curl -X POST https://VOTRE-APP.vercel.app/api/seed
```

Cela créera le compte admin et les données de démonstration.

---

## 📱 Comptes par défaut (après seed)

| Rôle | Email | Mot de passe |
|------|-------|-------------|
| Admin (Syndic) | admin@syndic.ma | admin123 |
| Propriétaire | othmane@email.com | owner123 |

---

## 🛠️ Développement local

```bash
# Installer les dépendances
npm install

# Configurer la base de données
cp .env.example .env
# Éditez .env avec votre DATABASE_URL

# Créer / synchroniser les tables
npx prisma db push

# Lancer le serveur
npm run dev
```

---

## 💳 Système d'abonnement (Admin immeuble)

L'Admin général peut créer, pour chaque immeuble, un **compte d'administration** (Admin immeuble) activé pour une **période d'abonnement** :

1. Section **Abonnements** du tableau de bord admin → « Nouveau compte »
2. Choix du nom, email, mot de passe, immeuble et durée (1 à 24 mois)
3. Le compte ne voit **que son immeuble** (données strictement isolées côté serveur)
4. À l'expiration : connexion et écritures bloquées, badge rouge « Expiré »
5. L'Admin général peut **renouveler** (en mois ou jusqu'à une date précise), **suspendre/réactiver** ou **supprimer** le compte

Statuts affichés : `Actif`, `Expire bientôt` (≤ 30 jours), `Expiré`, `Suspendu`.

---

## 📋 Fonctionnalités

- ✅ Authentification (connexion, inscription, mot de passe oublié)
- ✅ 3 rôles : Admin général (plateforme), Admin immeuble (abonné), Propriétaire
- ✅ Gestion des immeubles, appartements, propriétaires
- ✅ Cotisations mensuelles (validation par le syndic)
- ✅ Dépenses et frais de ménage
- ✅ Historique annuel avec Total du solde
- ✅ Comptes d'administration par immeuble avec **abonnement** (création, renouvellement, suspension, expiration automatique)
- ✅ Isolation stricte des données par immeuble (côté serveur)
- ✅ Exports PDF : historique, cotisations, dépenses (admin) + relevé personnel des cotisations (propriétaire)
- ✅ Notifications en temps réel
- ✅ PWA (installable sur mobile)
- ✅ Réinitialisation du mot de passe par email
