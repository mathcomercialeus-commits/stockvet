# Vet Stock Control

Sistema interno de controle de estoque para clinica veterinaria, com quatro estoques:

- Estoque interno
- Consultorio 1
- Consultorio 2
- Internacao

## Funcionalidades

- Login funcional com sessoes e perfis: administrador, gerente e veterinario.
- Administradores criam e excluem usuarios administrativos.
- Administradores excluem cadastros de produtos sem saldo aberto, preservando o historico.
- Gerentes criam e excluem usuarios veterinarios, lancam entradas manuais e entradas por XML somente no estoque interno, saidas com motivo e transferencias entre estoques.
- Na entrada XML, o gerente escolhe se a nota sera registrada como unidade ou ml.
- Na entrada manual, o codigo interno do produto e gerado automaticamente.
- Produtos em unidade podem ter conversao `ml por unidade`, permitindo transferencias, saidas e uso veterinario em ml sem quebrar os saldos.
- Veterinarios registram os produtos usados por comanda e setor.
- Gerentes aprovam ou rejeitam os registros dos veterinarios antes de movimentar o estoque.
- Administradores acessam dashboards, relatorios, conferencia e logs de auditoria.
- Administradores fazem balanco de estoque, registram divergencias e podem aplicar ajustes auditados.
- Todas as acoes relevantes geram log.

## Requisitos

- Node.js 24 ou superior.

O projeto usa `node:sqlite`, incluido no Node 24. Nenhuma dependencia externa e necessaria.

## Rodar localmente

```bash
npm start
```

Abra:

```text
http://localhost:3000
```

## Usuarios iniciais

| Perfil | E-mail | Senha |
| --- | --- | --- |
| Administrador | admin@vetstock.local | Admin#2026! |

Troque essas senhas antes de usar em producao.

## Publicar em um novo repositorio GitHub

Depois de criar um repositorio vazio no GitHub:

```bash
git remote add origin https://github.com/SEU_USUARIO/NOME_DO_REPOSITORIO.git
git branch -M main
git push -u origin main
```

## Subir no Render

O projeto ja inclui `render.yaml` com:

- Web Service Node.js.
- Health check em `/api/health`.
- Disco persistente em `/var/data` para salvar o SQLite.
- `DATA_DIR=/var/data`.

No Render:

1. Crie ou acesse sua conta em `https://render.com`.
2. Conecte o repositorio GitHub deste projeto.
3. Escolha `New` > `Blueprint`.
4. Selecione o repositorio.
5. Confirme a criacao do servico.

Importante: SQLite precisa de disco persistente para nao perder estoque, usuarios e logs quando o servico reiniciar. No Render, disco persistente exige plano pago. Em plano gratuito, use apenas para teste, porque arquivos locais podem ser apagados em reinicios ou novos deploys.
