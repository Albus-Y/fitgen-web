'use strict';
renderMathInElement(document.querySelector('.prose'), {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false }
  ],
  throwOnError: false,
  strict: 'ignore'
});
document.getElementById('print-button').addEventListener('click', () => window.print());
const imageDialog = document.getElementById('image-dialog');
document.querySelectorAll('.image-button').forEach(button => {
  button.addEventListener('click', () => {
    const image = button.querySelector('img');
    imageDialog.querySelector('img').src = image.src;
    imageDialog.querySelector('img').alt = image.alt;
    imageDialog.showModal();
  });
});
document.getElementById('close-dialog').addEventListener('click', () => imageDialog.close());
imageDialog.addEventListener('click', event => {
  if (event.target === imageDialog) {
    const rect = imageDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) imageDialog.close();
  }
});
