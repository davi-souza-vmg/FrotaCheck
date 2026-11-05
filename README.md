# FrotaCheck — Checklist de saída de veículos

Aplicação responsiva para equipe interna registrar inspeções de saída de ônibus, micro-ônibus e vans. O frontend fica no GitHub Pages; autenticação e dados sincronizados usam Google Apps Script, Google Sheets e Google Drive.

## Páginas

- `/` (raiz): menu inicial com os dois acessos.
- `/Checklist/`: página dos conferentes — cria e envia novos checklists (com fotos das avarias).
- `/Conferencia/`: página da gerência — consulta de todos os checklists enviados (lista, detalhes, fotos e PDF).

## Arquivos

- `index.html`, `styles.css`, `app.js`: interface e lógica do navegador.
- `manifest.webmanifest`, `sw.js`: instalação PWA e cache básico do aplicativo.
- `Code.gs`: API do Apps Script para login, listagem e gravação dos checklists, com fotos no Drive.

## 1. Propriedades do Google Apps Script

No projeto do Apps Script, abra **Configurações do projeto → Propriedades do script** e crie:

| Propriedade | Valor |
|---|---|
| `SPREADSHEET_ID` | `1mYFT8ScB_HULJHTWXQnRzBDnhxLrxpg1QoU-YETSHkc` |
| `DRIVE_FOLDER_ID` | `1cfZDqrymQ12KW94U8swLgi98xz70ePue` |
| `USERS_JSON` | JSON da lista de usuários, exemplo abaixo |

Exemplo inicial de `USERS_JSON` com a conta provisória da Kaltyn:

```json
[
  {"username":"kaltyn","password":"TROQUE_PELA_SENHA_ATUAL_DA_KALTYN","name":"Kaltyn","role":"operacional","active":true}
]
```

Quando for cadastrar a Katlyn, adicione outro objeto à lista, com `username`, `password`, `name` e `active:true`. Por exemplo:

```json
[
  {"username":"davi","password":"SENHA_ATUAL_DO_DAVI","name":"Davi Souza Ribeiro","role":"admin","active":true},
  {"username":"katlyn","password":"SENHA_ATUAL_DA_KATLYN","name":"Katlyn","role":"operacional","active":true},
  {"username":"auxiliar1","password":"DEFINA_UMA_SENHA_FORTE","name":"Nome do auxiliar","role":"auxiliar","active":true}
]
```

Substitua os textos provisórios por senhas fortes antes de uso real. O JSON deve ser válido: aspas duplas, sem comentários e sem vírgula após o último item. Para desativar alguém, defina `"active":false`.

**Segurança:** as senhas ficam em uma propriedade do script, não no JavaScript público do GitHub Pages. Ainda assim, editores do projeto Apps Script podem ver essas propriedades; conceda acesso de edição somente a administradores. Para ambiente com exigência de segurança elevada, recomenda-se autenticação corporativa/Google Identity em vez de senhas armazenadas no script.

## 2. Atualizar e publicar o Apps Script

1. Abra o projeto correspondente à implantação já existente.
2. Substitua o conteúdo de `Code.gs` pelo arquivo deste pacote.
3. Salve e execute manualmente `setupSheets()` uma vez, autorizando acesso à planilha e ao Drive.
4. Em **Implantar → Gerenciar implantações**, edite a implantação do Web App e selecione **Nova versão**. Execute como o proprietário/administrador que tem acesso à planilha e à pasta; configure o acesso de modo que os funcionários consigam chamar o endpoint. A validação de usuário é feita pelo código.
5. Copie a URL `/exec` da implantação e confira se corresponde à URL definida em `API_URL` no `app.js`. Se a URL da implantação mudar, atualize essa constante.

A API aceita ações `login`, `list`, `save`, `delete` e `logout`. Sessões expiram após seis horas. O nível de acesso é validado no servidor: não depende apenas de botões escondidos na interface. Fotos são guardadas na pasta configurada, sem tornar os arquivos públicos.

## Níveis de acesso

| Nível | Quem | Permissões |
|---|---|---|
| **Admin** | Davi | Visualiza todos os checklists e pode editar e excluir qualquer registro. |
| **Operacional** | Katlyn | Visualiza todos os checklists e pode criar novos, mas não editar nem excluir registros existentes. |
| **Auxiliar** | Outros usuários definidos como `auxiliar` | Pode criar checklists e visualizar somente os próprios. Não pode editar nem excluir registros existentes. |

Para cadastrar os níveis, atualize a propriedade `USERS_JSON` preservando os nomes de usuário e senhas atuais e acrescente o campo `role`: `admin`, `operacional` ou `auxiliar`. O código reconhece Davi como admin e Katlyn/Kaltyn como operacional pelos dados da conta; para os demais usuários, informe `role` explicitamente. **Não substitua as senhas atuais pelos exemplos deste README.** Depois de salvar o `Code.gs`, publique uma nova versão do Web App.

O servidor impede edição/exclusão por usuários não administradores mesmo que tentem chamar a API diretamente. A exclusão também envia as fotos associadas para a lixeira do Drive.

## 3. Publicar o site no GitHub Pages

Envie `index.html`, `styles.css`, `app.js`, `manifest.webmanifest` e `sw.js` para a raiz do repositório e publique em **Settings → Pages**. A URL padrão `/macros/s/.../exec` do Apps Script já está configurada em `API_URL`; confirme que o ID corresponde à implantação ativa antes de publicar.

## 4. Como funciona

- O login é validado pelo Apps Script usando `USERS_JSON`.
- O checklist é mantido apenas em memória enquanto a tela está aberta. Não existe salvamento automático, rascunho local ou fila offline.
- Ao enviar, o app grava diretamente na planilha e envia as fotos ao Drive. A confirmação só aparece quando o Apps Script responde com sucesso.
- Se não houver conexão ou o envio falhar, o registro não é guardado neste aparelho; será necessário manter a tela aberta e tentar enviar novamente. Ao atualizar ou fechar a página, os dados ainda não enviados são descartados.
- A tela Conferência consulta os registros diretamente na nuvem. Os registros recebidos ficam apenas na memória da página e são carregados novamente ao abrir ou atualizar.

## Observações importantes

- Apps Script pode aplicar limites de execução, armazenamento e chamadas. Teste com registros fictícios antes de usar operacionalmente.
- Como o frontend está no GitHub Pages e o backend em outro domínio, o navegador pode bloquear chamadas por CORS dependendo do redirecionamento da implantação do Apps Script. Se aparecer erro de rede/CORS no login, primeiro confirme que a implantação está ativa e acessível e que a URL `/macros/s/.../exec` corresponde à versão publicada. A URL `/a/macros/<domínio>/s/.../exec` é específica do domínio Google Workspace e pode redirecionar de forma incompatível com `fetch`. Se ainda houver CORS, a correção robusta é hospedar a interface no Apps Script usando `google.script.run` ou colocar uma API intermediária com CORS configurado; não contorne isso tornando os dados públicos.
- Faça um teste completo: login válido e inválido, salvar checklist, anexar foto, atualizar página, entrar de novo e confirmar que o registro voltou da nuvem.


## Atualização automática e visualização de fotos

Esta versão atualiza os registros da nuvem automaticamente a cada 5 segundos enquanto o painel de Conferência estiver visível e ao voltar para a aba/janela do FrotaCheck. Ao retornar a conexão, a lista é carregada novamente. O formulário de Checklist não é salvo nem sincronizado em segundo plano.

A consulta periódica busca primeiro os dados dos cards e as avaliações, sem baixar imagens. As fotos são carregadas somente quando alguém abre um checklist específico, reduzindo o tráfego e as leituras desnecessárias no Google Drive. Enquanto o formulário está aberto, a consulta automática de alterações pausa. Nenhum conteúdo digitado é enviado antes do clique em Enviar formulário.

As fotos do formulário e da visualização do checklist podem ser clicadas para abrir uma galeria ampliada. O preview oferece zoom por botões ou roda do mouse, botão para ajustar à tela, arraste quando ampliado e fechamento pelo botão ou tecla Esc.

### Instalação desta melhoria

1. Substitua no GitHub Pages os arquivos `index.html`, `app.js`, `styles.css`, `sw.js` e a pasta `icons` pelos arquivos desta versão.
2. No projeto Apps Script, substitua o `Code.gs` pelo arquivo atualizado.
3. Salve e publique uma **Nova versão** da implantação existente do Web App.
4. Abra o FrotaCheck e use `Ctrl + F5`. Se estiver instalado como PWA e continuar exibindo a versão anterior, feche e abra o aplicativo novamente.
5. Teste o envio de um checklist, confirme que aparece na tela Conferência e atualize a página para verificar que ele é recuperado da nuvem. Depois, teste o fluxo também em um celular.

Observação: a sincronização automática não é um canal push instantâneo; consulta o Apps Script a cada 5 segundos. A latência depende da conexão, do tempo de resposta do Apps Script e das cotas do Google.


## Refinamento visual do checklist e da Gerência

- O checklist usa seletores segmentados com três estados independentes: ✕ Não OK (vermelho), / Não se aplica (neutro) e ✓ OK (verde), com transição curta ao selecionar.
- O campo de observação de cada item aparece somente quando a resposta é `/` ou `✓`. Ao marcar `✕`, a observação daquele item é limpa.
- As perguntas foram reescritas para que uma resposta positiva indique uma condição adequada do veículo.
- As seções agora seguem uma numeração contínua: 01 Identificação, 02 a 07 inspeções, 08 Itens operacionais e 09 Avarias e observações. Os títulos usam o mesmo padrão visual.
- O layout mobile impede rolagem horizontal, mantém os três indicadores da Gerência alinhados na mesma fileira e simplifica os filtros.
- Para a atualização rápida da Gerência, publique também o `Code.gs` atualizado. A ação `listMeta` passou a retornar os dados necessários aos cards sem baixar fotos em lote; as fotos continuam sendo obtidas ao abrir um registro. O frontend possui fallback para APIs antigas, mas esse fallback é mais lento.
