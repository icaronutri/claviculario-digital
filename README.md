# Claviculário Digital — chaves de viaturas

Substitui o livro físico do Sgt de Dia para a cautela das chaves das viaturas, com **assinatura feita com o dedo na tela** e um **monitor (segunda tela)** que mostra o claviculário em tempo real.

## Como funciona

| Cor | Situação |
|---|---|
| 🟩 Verde | Viatura disponível (chave no claviculário) |
| 🟨 Amarelo | Viatura em uso (chave cautelada para missão) |
| 🟥 Vermelho | Viatura em manutenção (não pode sair) |
| ⬚ Cinza tracejado | Posição vaga |

- **Posições numeradas.** As posições fixas ficam com as viaturas da STS. As posições vagas recebem viaturas **temporárias** de outros setores (ex.: o Rancho deixa uma viatura e o Sgt de Dia coloca a chave na posição 20).
- **Serviço do Sgt de Dia.** O Sgt **assume o serviço** e, na **passagem de serviço**, o próximo assume. A tela de passagem mostra a conferência das chaves que estão fora. Cada saída e devolução fica registrada no serviço de quem estava de dia.
- **Saída da viatura.** Registra motorista, viatura (prefixo, modelo e placa), **missão**, destino e odômetro, se quiser. O motorista assina com o dedo e o **horário de saída** é gravado automaticamente.
- **Devolução.** O motorista que entrega a chave assina; pode ser o mesmo da saída ou outro. O odômetro é opcional e o sistema calcula os km rodados.
- **Viatura temporária que não volta.** Se a viatura foi direto para o setor de origem, o Sgt marca "não retornou à STS" e a posição fica vaga. A temporária também pode ser devolvida ao setor sem ter saído em missão, com a assinatura de quem recebeu.
- **Monitor.** Botão **🖥 Monitor** no topo. Abre uma janela para arrastar até o segundo monitor e deixar em tela cheia (⛶). Ela se atualiza sozinha a cada movimentação, se ajusta para caber todas as posições e mostra o relógio e o Sgt de Dia.
- **Livro de cautelas.** Filtros por período, viatura e serviço; visualização das assinaturas; impressão e **exportação para Excel (CSV)**.
- **Militares.** Cadastro de posto, nome, SARAM, setor e telefone. Também dá para cadastrar na hora, direto na tela de saída.
- **Perfis.** *Operador* (computador do Sgt de Dia) e *administrador* (cadastra viaturas fixas, define a quantidade de posições, gerencia usuários e vê a auditoria).

## Como rodar

Precisa apenas do [Node.js](https://nodejs.org) **22.13 ou mais novo** — não há dependências para instalar.

```bash
npm start
```

Abra <http://localhost:3000> e entre com **admin / admin123**. Depois, troque a senha.

### Primeira configuração
1. **Viaturas → Posições do claviculário**: informe quantos números o claviculário tem (o padrão é 30).
2. **Viaturas → + Nova viatura**: cadastre as viaturas fixas da STS, cada uma em sua posição.
3. **Usuários → + Novo usuário**: crie um login *operador* para o computador do Sgt de Dia.
4. No computador do Sgt de Dia: entre com esse login, clique em **Assumir serviço** e depois em **🖥 Monitor**, e arraste a janela para a segunda tela.

Para usar em outros computadores ou tablets da rede, acesse pelo IP da máquina onde o sistema roda (ex.: `http://192.168.0.10:3000`).

### Configuração (variáveis de ambiente)

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `DB_PATH` | `dados/claviculario.db` | Arquivo do banco SQLite (**faça backup dele**) |
| `ADMIN_SENHA` | `admin123` | Senha do admin criado na primeira execução |
| `POSICOES_INICIAIS` | `30` | Nº de posições criadas na primeira execução |
| `EXIGIR_ASSINATURA` | `1` | `0` torna a assinatura opcional |
| `SESSAO_HORAS` | `24` | Tempo sem uso até pedir login de novo (renova a cada uso) |
| `TZ` | `America/Sao_Paulo` | Fuso das datas no CSV |

## Testes

```bash
npm test
```

## Estrutura

```
server.js             inicia o servidor
src/db.js             banco SQLite (posições, viaturas, cautelas, serviços…)
src/app.js            API REST, regras e tempo real (Server-Sent Events)
public/index.html     tela de controle do Sgt de Dia
public/monitor.html   monitor (segunda tela)
public/assinatura.js  quadro de assinatura com o dedo
test/                 testes da API
```
