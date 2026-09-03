# Vet Stock Control

Sistema interno de controle de estoque para clinica veterinaria, com quatro estoques:

- Estoque interno
- Consultorio 1
- Consultorio 2
- Internacao

## Funcionalidades

- Login funcional com sessoes e perfis: administrador, gerente e veterinario.
- Gerentes cadastram produtos, veterinarios, entradas manuais, entradas por XML e saidas com motivo.
- Veterinarios registram os produtos usados por comanda e setor.
- Gerentes aprovam ou rejeitam os registros dos veterinarios antes de movimentar o estoque.
- Administradores acessam dashboards, relatorios, conferencia e logs de auditoria.
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
| Gerente | gerente@vetstock.local | Gerente#2026! |
| Veterinario | vet@vetstock.local | Vet#2026! |

Troque essas senhas antes de usar em producao.

## Publicar em um novo repositorio GitHub

Depois de criar um repositorio vazio no GitHub:

```bash
git remote add origin https://github.com/SEU_USUARIO/NOME_DO_REPOSITORIO.git
git branch -M main
git push -u origin main
```
