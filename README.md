# 🌉 Bridge Defense - Last Stand

Um jogo de defesa tática 3D estilo arcade/hyper-casual construído em um único arquivo com **PlayCanvas WebGL** e **Web Audio API** procedural.

## 🎮 Sobre o Jogo

Defenda a ponte oceânica contra ondas implacáveis de inimigos e chefes! Controle seu pelotão, desvie de obstáculos, destrua portões multiplicadores e cristais para recrutar mais soldados e melhorar seu poder de fogo.

### Principais Recursos
- **Gráficos 3D (PlayCanvas)**: Iluminação ACES Tonemapping, neblina atmosférica, sombras suaves e texturas geradas proceduralmente via Canvas.
- **Áudio Procedural (Web Audio API)**: Trilha sonora dinâmica e efeitos sonoros sintetizados em tempo real (sem arquivos de áudio externos).
- **Gameplay Dinâmico**:
  - Recrutamento de esquadrão e upgrades de armas em tempo real.
  - Diferentes classes de inimigos (Runners, Brutes, Bosses).
  - Sistema de combo, partículas, ondas de choque e câmera com *screen shake*.
  - Suporte completo para Desktop (Teclado/Mouse) e Mobile (Touch/Drag).

## 🕹️ Controles

| Ação | Teclado / Mouse | Mobile |
| :--- | :--- | :--- |
| **Mover Pelotão** | `A` / `D`, `←` / `→` ou Arrastar Mouse | Arrastar na tela |
| **Pular** | `Espaço`, `W` ou `↑` | — |
| **Pausar** | `P` ou `Esc` | Botão de Pausa na HUD |
| **Mutar Áudio** | `M` | Botão de Áudio na HUD |

## 🚀 Como Executar

Por ser um projeto *zero-dependency* no front-end, basta abrir o arquivo [`index.html`](./index.html) em qualquer navegador moderno ou servi-lo localmente:

```bash
npx serve .
# ou
python3 -m http.server 8080
```

## 🧪 Testes Automatizados

O projeto inclui uma suíte de testes automatizados via **Chrome DevTools Protocol (CDP)** puro em Node.js (`test-cli.js`), sem dependências externas:

```bash
npm test
```
