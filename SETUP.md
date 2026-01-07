# 🚀 Guia de Configuração Rápida - FitPoint com PostgreSQL

## Passo a Passo para Iniciar

### 1. Instalar PostgreSQL

**Windows:**
- Baixe do site oficial: https://www.postgresql.org/download/windows/
- Durante instalação, anote a senha do usuário `postgres`

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**macOS:**
```bash
brew install postgresql
brew services start postgresql
```

### 2. Verificar Banco de Dados

O sistema usa o banco **existente** `nimu_pwa_db`. Não é necessário criar um novo banco.

O sistema criará automaticamente o schema `fitpoint` dentro do banco existente.

Para verificar se o banco existe:
```bash
# Conectar ao PostgreSQL
psql -U postgres

# Listar bancos
\l

# Verificar se nimu_pwa_db existe
# Se não existir, criar:
# CREATE DATABASE nimu_pwa_db;

# Sair
\q
```

### 3. Configurar Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env`:

```bash
cp .env.example .env
```

Edite `.env` e configure:

**Desenvolvimento local:**
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nimu_pwa_db
DB_USER=postgres
DB_PASSWORD=admin
DB_SCHEMA=fitpoint
```

**Produção (Render.com):**
```env
DB_HOST=dpg-d19p0cadbo4c73bmm1gg-a.virginia-postgres.render.com
DB_PORT=5432
DB_NAME=nimu_pwa_db
DB_USER=nimu_pwa_db_user
DB_PASSWORD=UvT5097jnjUPGRQtkswiFaVnUgW2bur0
DB_SSL=true
DB_SCHEMA=fitpoint
```

**Outras configurações:**
- `JWT_SECRET`: String aleatória segura (ex: gere com `openssl rand -hex 32`)
- `ADMIN_PASSWORD`: Senha forte para o usuário admin

### 4. Instalar Dependências

```bash
npm install
```

### 5. Migrar Banco de Dados

Este comando cria o **schema `fitpoint`** (se não existir), as tabelas e migra os dados dos JSONs:

```bash
npm run migrate
```

Você verá:
- ✅ Schema `fitpoint` criado no banco existente
- ✅ Tabelas criadas dentro do schema
- 👤 Usuário admin criado (com as credenciais do .env)
- 📦 Produtos migrados
- 🍳 Receitas migradas

**Importante:** Todas as tabelas serão criadas no schema `fitpoint`, não no schema `public` padrão.

### 6. Iniciar o Servidor

```bash
npm start
```

Para desenvolvimento com auto-reload:

```bash
npm run dev
```

### 7. Acessar o Sistema

- **Site Principal**: http://localhost:3000
- **Painel Admin**: http://localhost:3000/admin.html
  - Usuário: `admin` (ou o configurado no .env)
  - Senha: A senha configurada no `.env`
- **API Health**: http://localhost:3000/api/health

## ✅ Verificar se está funcionando

1. **Teste da API:**
   - http://localhost:3000/api/health → `{"status":"ok",...}`
   - http://localhost:3000/api/products → Lista de produtos JSON

2. **Teste do Admin:**
   - Acesse http://localhost:3000/admin.html
   - Faça login com credenciais do .env
   - Deve mostrar produtos e receitas

3. **Teste Público:**
   - Acesse http://localhost:3000/cardapio.html
   - Deve mostrar produtos sem precisar de login

## 🔧 Problemas Comuns

### Erro: "Cannot connect to PostgreSQL"
- Verifique se PostgreSQL está rodando: `pg_isready` (Linux/Mac) ou serviços do Windows
- Verifique credenciais no `.env` (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD)
- Tente conectar manualmente: `psql -U postgres -d fitpoint`

### Erro: "database does not exist"
- Verifique se o banco `nimu_pwa_db` existe
- Se não existir, crie: `CREATE DATABASE nimu_pwa_db;`
- Ou use: `createdb -U postgres nimu_pwa_db`

### Verificar Schema Criado
Para verificar se o schema foi criado corretamente:
```bash
psql -U postgres -d nimu_pwa_db

# Listar schemas
\dn

# Ver tabelas do schema fitpoint
\dt fitpoint.*

# Ver estrutura de uma tabela
\d fitpoint.products
```

### Erro: "Port 3000 already in use"
- Pare o processo na porta 3000 ou defina outra porta no `.env`:
  ```env
  PORT=3001
  ```

### Erro: "Module not found"
- Execute `npm install` novamente
- Verifique se `node_modules/` existe

### Erro de autenticação no admin
- Verifique se o usuário foi criado: `npm run migrate` novamente
- Verifique credenciais no `.env`
- Limpe o localStorage do navegador e tente novamente

## 🌐 Deploy em Produção

### Checklist:

- [ ] PostgreSQL instalado e acessível
- [ ] Banco de dados criado
- [ ] `.env` configurado com credenciais reais
- [ ] `JWT_SECRET` alterado para string segura
- [ ] `ADMIN_PASSWORD` alterado para senha forte
- [ ] `CORS_ORIGIN` configurado (domínio do frontend)
- [ ] `DB_SSL=true` se usar PostgreSQL gerenciado (Heroku, etc)
- [ ] HTTPS configurado
- [ ] Firewall configurado (porta 5432 para PostgreSQL, 3000 para API)

### Comandos de Deploy:

```bash
# No servidor
git clone <seu-repo>
cd FITPOINT
npm install
cp .env.example .env
# Edite .env com credenciais de produção
npm run migrate
npm start
# Ou use PM2: pm2 start server.js --name fitpoint
```

## 📝 Próximos Passos

1. Customize produtos e receitas através do painel admin
2. Configure backup do PostgreSQL
3. Configure monitoramento e logs
4. Configure HTTPS com certificado SSL

## 🔐 Segurança

⚠️ **IMPORTANTE EM PRODUÇÃO:**
- Altere todas as senhas padrão
- Use `JWT_SECRET` forte e único
- Configure `CORS_ORIGIN` para seu domínio
- Use HTTPS sempre
- Mantenha PostgreSQL atualizado
- Configure firewall adequadamente
