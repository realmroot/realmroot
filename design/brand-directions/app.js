const conceptButtons = document.querySelectorAll('[data-select-concept]')
const screenButtons = document.querySelectorAll('[data-select-screen]')
const screenPanels = document.querySelectorAll('[data-screen-panel]')

for (const button of conceptButtons) {
  button.addEventListener('click', () => {
    const concept = button.dataset.selectConcept
    document.body.dataset.concept = concept

    for (const candidate of conceptButtons) {
      const selected = candidate === button
      candidate.classList.toggle('is-selected', selected)
      candidate.setAttribute('aria-pressed', String(selected))
    }
  })
}

for (const button of screenButtons) {
  button.addEventListener('click', () => {
    const screen = button.dataset.selectScreen
    document.body.dataset.screen = screen

    for (const candidate of screenButtons) {
      candidate.classList.toggle('is-active', candidate === button)
    }

    for (const panel of screenPanels) {
      panel.classList.toggle('is-visible', panel.dataset.screenPanel === screen)
    }
  })
}
