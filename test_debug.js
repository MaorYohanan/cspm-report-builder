const container = document.createElement('div');
container.innerHTML = '<span class="cat-badge" data-cat="CSPM">Test</span>';

const filterCat = document.createElement('select');

const badge = container.querySelector('[data-cat="CSPM"]');
badge.addEventListener('click', function() {
  console.log('Clicked!');
  console.log('getAttribute:', badge.getAttribute('data-cat'));
  filterCat.value = badge.getAttribute('data-cat');
  console.log('filterCat.value after set:', filterCat.value);
});

badge.click();
console.log('Final filterCat.value:', filterCat.value);
