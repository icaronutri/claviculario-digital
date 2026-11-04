# Claviculário Digital

Sistema web para controlar as chaves do claviculário: quem retirou, quando, quando devolveu, com **assinatura feita com o dedo na tela** (tablet/celular) ou com o mouse.

## Funcionalidades

- **Painel de chaves**: cada chave aparece num cartão colorido (verde = disponível, amarelo = retirada, vermelho = atrasada), com busca e filtro. Toque na chave para retirar ou devolver.
- **Retirada**: escolhe quem está retirando, uma previsão de devolução (opcional), uma observação e **a pessoa assina com o dedo**.
- **Devolução**: registra quem devolveu (pode ser outra pessoa), observações (avarias etc.) e **assinatura**.
- **Chaves com acesso restrito**: só as pessoas autorizadas podem retirar.
- **Histórico** com filtro por período e chave, visualização das assinaturas e **exportação para CSV** (abre no Excel).
- **Cadastro de pessoas** (nome, matrícula/SARAM/CPF, posto/cargo, setor, telefone).
- **Usuários do sistema** com dois perfis: *operador* (retira/devolve, cadastra pessoas) e *administrador* (também gerencia chaves, usuários e vê a auditoria).
- **Auditoria** de logins e de todas as alterações.

## Como rodar

Precisa apenas do [Node.js](https://nodejs.org) **22.13 ou mais novo** — não há dependências para instalar.

```bash
npm start
```

Abra <http://localhost:3000> e entre com **admin / admin123**. Troque a senha logo no primeiro acesso (botão **Senha**).

Para usar no tablet do claviculário, acesse pelo IP do computador na rede (ex.: `http://192.168.0.10:3000`).

### Configuração (variáveis de ambiente)

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `DB_PATH` | `dados/claviculario.db` | Arquivo do banco SQLite (faça backup dele) |
| `ADMIN_SENHA` | `admin123` | Senha do admin criado na primeira execução |
| `EXIGIR_ASSINATURA` | `1` | Use `0` para tornar a assinatura opcional |
| `TZ` | `America/Sao_Paulo` | Fuso usado nas datas do CSV |

## Testes

```bash
npm test
```

## Estrutura

```
server.js            inicia o servidor
src/db.js            esquema do banco SQLite e senhas (scrypt)
src/app.js           API REST e regras de negócio
public/              interface web (HTML/CSS/JS puro)
public/assinatura.js quadro de assinatura com o dedo (Pointer Events)
test/                testes da API
```
