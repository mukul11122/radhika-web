// mobile menu
const toggle = document.getElementById('menuToggle');
const nav = document.getElementById('mainNav');
toggle.addEventListener('click', () => nav.classList.toggle('open'));
nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));

// year
document.getElementById('year').textContent = new Date().getFullYear();

// product gallery populate
const productImages = [
  'img1.jpg','img2.jpg','img3.jpg','img4.jpg','img5.jpg','img6.jpg'
];
const grid = document.getElementById('productGrid');
productImages.forEach((img, i) => {
  const el = document.createElement('img');
  el.src = 'assets/img/' + img;
  el.alt = 'Jan Aushadhi PMBJP product range ' + (i + 1);
  el.loading = 'lazy';
  grid.appendChild(el);
});

// contact form (client-side demo)
function submitForm(e){
  e.preventDefault();
  const f = e.target;
  const msg = document.getElementById('formMsg');
  msg.textContent = 'Thank you, ' + f.name.value + '! Your enquiry has been received. We will contact you shortly.';
  f.reset();
  return false;
}
