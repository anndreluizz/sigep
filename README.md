# SIGEP – Sistema de Gestão de Ponto

Ponto eletrônico da Prefeitura: totem com QR Code em cada setor, RH, chefes de setor, Prefeito e servidor.
Páginas web estáticas (instaláveis no celular/tablet) + banco no Supabase, com as regras de acesso no próprio banco.

- `index.html` – o sistema (precisa do Supabase configurado em `js/config.js`)
- `demo.html` – demonstração com o mesmo banco rodando no navegador, dados fictícios
- `totem.html` – o totem do setor: tablet com câmera frontal lê o QR do crachá; sem internet, guarda as batidas e envia depois (`totem.html?demo` para a demonstração; os crachás impressos em `demo.html` funcionam nele)
- `supabase/` – migrações, testes e como colocar no ar (`supabase/LEIAME.md`)

## Testar
```
cd supabase && npm install && npm test
```
Para abrir a demonstração no computador: `python -m http.server` na pasta do projeto e acesse http://localhost:8000/demo.html
(login `rh@demo`, `chefe@demo`, `prefeito@demo`, `servidor@demo` ou `totem@demo`, senha `demo1234`).
