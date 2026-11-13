# Claviculário Digital — chaves de viaturas

Sistema para o **Sgt de Dia** controlar as chaves das viaturas, no lugar do livro físico. Tem **assinatura com o dedo na tela** e um **monitor para a segunda tela** que mostra o claviculário em tempo real.

Feito só com **HTML, CSS e JavaScript**: roda direto no navegador (Chrome ou Edge), **sem instalar nada e sem internet**.

## Como abrir

| Jeito | Como |
|---|---|
| **Dois cliques** | Abra o arquivo **`index.html`** |
| **Porta local** | Dois cliques em **`ABRIR-NA-PORTA-8080.bat`** e o navegador abre em <http://localhost:8080> (usa o PowerShell do Windows, ou o Node.js se estiver instalado) |
| **Link (GitHub Pages)** | <https://icaronutri.github.io/claviculario-digital/> (depois de ligar em *Settings → Pages → Branch: main*) |

Para testar: **Backup → Carregar dados de exemplo**.

> Cada jeito de abrir guarda os dados **separadamente**: o navegador trata cada endereço como um site diferente. Escolha um e use sempre o mesmo.

## Cores

| Cor | Situação |
|---|---|
| 🟩 Verde | Disponível (chave no claviculário) |
| 🟨 Amarelo | Em uso (chave cautelada para missão) |
| 🟥 Vermelho | Em manutenção (não pode sair) |
| ⬚ Tracejado | Posição vaga |

## O que o sistema faz

- **Posições numeradas:** cada viatura fixa da STS tem a sua posição. As posições vagas recebem **viaturas temporárias** de outros setores (ex.: Rancho na posição 20).
- **Serviço do Sgt de Dia:** *Assumir serviço* e *Passagem de serviço*, com a **conferência das chaves que estão fora**. Toda saída e devolução fica ligada ao serviço de quem estava de dia.
- **Saída:** motorista, viatura (prefixo, modelo e placa), **missão**, destino e odômetro (opcionais) e **assinatura**. O horário é registrado automaticamente.
- **Devolução:** o motorista que entrega (o mesmo ou outro) assina.
- **Temporária que não volta:** marque *"não retornou à STS"* e a posição fica vaga. Também dá para devolver a viatura ao setor de origem com a assinatura de quem recebeu.
- **Manutenção:** a viatura fica vermelha e o sistema não deixa ela sair.
- **Monitor:** botão **🖥 Monitor**. Arraste a janela para a segunda tela e aperte ⛶. Ele se atualiza sozinho e ajusta o tamanho dos cartões para caber todas as posições.
- **Livro de cautelas:** filtros, assinaturas, impressão e **exportação para Excel (CSV)**.
- **Backup:** salva e restaura tudo, inclusive as assinaturas, num arquivo `.json`.

## ⚠️ Onde ficam os dados

Os dados ficam **guardados no navegador do computador** (IndexedDB). Fechar o navegador ou desligar o computador não apaga nada, mas **limpar os dados do navegador apaga**.

- Faça **Backup → Salvar backup agora** **toda semana** e guarde o arquivo num pendrive ou na rede.
- Use sempre o **mesmo navegador** e **não use a janela anônima**.
- Os dados **não vão para a internet nem para o GitHub**. O GitHub guarda só o programa.

## Arquivos

```
index.html              tela de controle do Sgt de Dia
monitor.html            monitor (segunda tela)
css/estilo.css          visual da tela de controle
css/monitor.css         visual do monitor
js/armazenamento.js     guarda os dados no navegador (IndexedDB)
js/regras.js            regras: cautelas, serviço, temporárias, manutenção
js/comum.js             funções usadas pelas duas telas
js/assinatura.js        quadro de assinatura com o dedo
js/app.js               telas do controle
js/monitor.js           monitor
icone.svg               ícone
ABRIR-NA-PORTA-8080.bat abre em http://localhost:8080
ferramentas/            servidor local simples (PowerShell / Node.js)
test/                   testes automáticos das regras (node --test)
```

A versão anterior, com servidor em Node.js e login, continua no histórico do Git (registro `cb2766a`).
