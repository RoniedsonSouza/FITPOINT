require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');

// Routes
const productsRoutes = require('./routes/products');
const recipesRoutes = require('./routes/recipes');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Servir arquivos estáticos (frontend)
app.use(express.static(path.join(__dirname)));

// Rotas da API (públicas para leitura, autenticadas para escrita)
app.use('/api/products', productsRoutes);
app.use('/api/recipes', recipesRoutes);
app.use('/api/auth', authRoutes);

// Rota de health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'FitPoint API está funcionando',
    timestamp: new Date().toISOString()
  });
});

// Rota raiz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota para arquivos de extensões do navegador (ignorar erros 404)
app.get('/static/js/bundle.js', (req, res) => {
  res.status(204).send(); // No Content - ignora requisição
});

app.get('/assets/image/favicon-96x96.png', (req, res) => {
  res.redirect('/assets/logo.png');
});

app.get('/assets/image/favicon.svg', (req, res) => {
  res.redirect('/assets/logo.png');
});

// Rotas para ignorar erros de extensões do navegador
app.get('/static/js/bundle.js', (req, res) => {
  res.status(204).send(); // No Content - ignora requisição
});

app.get('/assets/image/favicon-96x96.png', (req, res) => {
  res.redirect('/assets/logo.png');
});

app.get('/assets/image/favicon.svg', (req, res) => {
  res.redirect('/assets/logo.png');
});

// Tratamento de erros 404
app.use((req, res) => {
  // Se for arquivo HTML, tentar servir
  if (req.path.endsWith('.html')) {
    const filePath = path.join(__dirname, req.path);
    const fs = require('fs');
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Tratamento de erros
app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor FitPoint rodando na porta ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔧 API: http://localhost:${PORT}/api`);
  console.log(`🔐 Admin: http://localhost:${PORT}/admin.html`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
});
