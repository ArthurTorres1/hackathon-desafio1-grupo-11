# Integração do Design System ForestTrace v2

Pacote fornecido pelo usuário em `C:/Users/arthu/Downloads/ForestTrace_Design_System_v2/ForestTrace_Design_System_v2`. Tokens e componentes de referência foram incorporados em `apps/web/src/design-system`, com o catálogo de rótulos `domain-ui.json`. O CSS global de prototype-reference.html não foi importado.

O adapter.css aplica os tokens às classes da aplicação existente: fundo creme, verde/sálvia, acento lima e lacunas em âmbar; tipografia local Segoe UI/Arial, títulos Georgia, corpo16px/auxiliar14px/metadados12px; controles44px, foco visível e painéis/bordas semânticos. Não há download de Google Fonts. O layout usa navegação224/180px no desktop e compacta no topo em telas menores, preservando as oito etapas operacionais.

ThemeToggle em React acompanha o contrato do pacote: inicialização síncrona no head, html[data-theme], localStorage foresttrace-theme, preferência do sistema até escolha explícita, tratamento de armazenamento indisponível e atualização de theme-color. A escolha persiste ao recarregar. Mapas vetoriais usam os tokens e reagem ao tema; imagens raster não são invertidas.

Os quatro atalhos executivos mantêm os fluxos já conectados: visão geral, lotes/origens, passaporte e computação verde. O componente DomainBadge consome o catálogo fornecido e mantém os códigos técnicos junto ao rótulo. O bloco de computação mede somente o carregamento de uma navegação quando solicitado; cache/CPU/IA/energia/emissões não medidos não recebem métricas fictícias.

Verificação inicial: build web aprovado e14testes de navegador desktop/móvel aprovados (seis do design system e oito de regressão das etapas). Cobertos persistência do tema, sistema, armazenamento bloqueado, foco, controles44px, largura320px sem rolagem da página e ausência de requisições a Google Fonts. Capturas em test-results/design-system foram inspecionadas. Ajustes finais de tipografia/controles Leaflet mantêm tokens sem inverter os tiles. Essa verificação não equivale a uma certificação integral de acessibilidade ou teste com todos os leitores de tela.

As regras de saldo, permissões, prontidão e os rótulos de evidência do backend permanecem como autoridade. A aparência não promove documentos ou dados simulados a aprovação.

Regressão final: 38 testes de navegador passaram, com quatro testes que exigem API/banco em3000 explicitamente ignorados nesta rodada visual. Cobertos os formulários, calculadora, transporte, revisão, trace, Whisp, consulta pública e seis testes específicos do tema/design. Build TypeScript/Vite aprovado. A imagem local foi reconstruída para servir a versão atualizada em127.0.0.1:3001.
