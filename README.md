# codexsun
Up in the cloud, where Dreams sync.

Minimal monorepo with a single starter app: **cxsun**.

## Prerequisites
- Node.js ≥ 18
- pnpm (Corepack: `corepack enable && corepack prepare pnpm@latest --activate`)

# install pnpm globally - Performant Node Package Manager
```
npm install -g pnpm
```

## Install
From the repo root:
```
pnpm install
```

# copy .env.example to .env and update values as needed.
```
cp .env.example .env
```


# To run Migrate

Check .env file for database connection details.
From the repo root: 

>DB_DRIVER=postgresql | mysql | mariadb | sqlite \
 DB_HOST=localhost \
 DB_PORT=5432 | 3606 \
 DB_USER=yourusername \
 DB_PASSWORD=yourpassword \
 DB_NAME=yourdatabase \


Run the following command to apply migrations:


```
pnpm cx migrate fresh 
```

add docs