(() => {
  'use strict';

  const page = document.querySelector('[data-network-map]');
  if (!page) return;

  const canvas = page.querySelector('[data-network-canvas]');
  const panel = page.querySelector('[data-network-panel]');
  const summary = page.querySelector('[data-network-summary]');
  const search = page.querySelector('[data-network-search]');
  const countrySelect = page.querySelector('[data-network-country]');
  const reset = page.querySelector('[data-network-reset]');
  const unmappedContainer = page.querySelector('[data-network-unmapped]');
  const dataNode = document.getElementById('network-map-data');

  if (!canvas || !panel || !summary || !search || !countrySelect || !reset || !dataNode) return;

  const escapeHTML = (value) => String(value || '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));

  const countryAliases = { USA: 'United States' };
  const coordinates = {
    Argentina: [-38.42, -63.62],
    Australia: [-25.27, 133.78],
    Austria: [47.52, 14.55],
    Belgium: [50.85, 4.35],
    Canada: [56.13, -106.35],
    Chile: [-35.68, -71.54],
    China: [35.86, 104.20],
    Denmark: [56.26, 9.50],
    Estonia: [58.60, 25.01],
    France: [46.23, 2.21],
    Germany: [51.17, 10.45],
    'Hong Kong': [22.32, 114.17],
    Hungary: [47.16, 19.50],
    Iceland: [64.96, -19.02],
    India: [20.59, 78.96],
    Italy: [41.87, 12.57],
    Japan: [36.20, 138.25],
    Malaysia: [4.21, 101.98],
    Netherlands: [52.13, 5.29],
    'New Zealand': [-40.90, 174.89],
    Norway: [60.47, 8.47],
    Poland: [51.92, 19.15],
    Portugal: [39.40, -8.22],
    Romania: [45.94, 24.97],
    Russia: [61.52, 105.32],
    Spain: [40.46, -3.75],
    Sweden: [60.13, 18.64],
    Switzerland: [46.82, 8.23],
    'Türkiye': [38.96, 35.24],
    'United Kingdom': [55.38, -3.44],
    'United States': [39.83, -98.58]
  };

  let people;
  try {
    people = JSON.parse(dataNode.textContent || '[]');
  } catch (error) {
    summary.textContent = 'The network directory could not be loaded.';
    return;
  }

  people = Object.values(people.reduce((uniquePeople, person) => {
    const identity = String(person.name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!uniquePeople[identity] || person.category === 'Core team') uniquePeople[identity] = person;
    return uniquePeople;
  }, {}));

  const mappedPeople = people.map((person) => ({
    ...person,
    country: countryAliases[person.country] || person.country
  })).filter((person) => coordinates[person.country]);
  const unmappedPeople = people.filter((person) => !coordinates[countryAliases[person.country] || person.country]);
  const sites = Object.values(mappedPeople.reduce((grouped, person) => {
    if (!grouped[person.country]) grouped[person.country] = {
      country: person.country,
      coordinates: coordinates[person.country],
      people: []
    };
    grouped[person.country].people.push(person);
    return grouped;
  }, {})).sort((a, b) => a.country.localeCompare(b.country));

  const renderEmptyPanel = (message = 'Choose a country marker or use the search and country controls to find researchers across #EEGManyLabs.') => {
    panel.innerHTML = `
      <div class="network-map__panel-empty">
        <span class="network-map__panel-kicker">Explore the network</span>
        <h2>Select a marker</h2>
        <p>${escapeHTML(message)}</p>
      </div>`;
  };

  const renderSite = (site) => {
    const peopleMarkup = [...site.people].sort((a, b) => a.name.localeCompare(b.name)).map((person) => {
      const nameMarkup = person.url
        ? `<a href="${escapeHTML(person.url)}">${escapeHTML(person.name)}</a>`
        : `<strong>${escapeHTML(person.name)}</strong>`;
      return `
      <article class="network-map__person">
        ${nameMarkup}
        <p>${escapeHTML(person.affiliation || 'Affiliation not listed')}</p>
      </article>`;
    }).join('');
    panel.innerHTML = `
      <div class="network-map__panel-header">
        <span class="network-map__panel-kicker">${escapeHTML(site.country)}</span>
        <h2>${site.people.length} ${site.people.length === 1 ? 'member' : 'members'}</h2>
      </div>
      <div class="network-map__people">${peopleMarkup}</div>`;
    panel.scrollTop = 0;
  };

  const renderUnmapped = () => {
    if (!unmappedPeople.length || !unmappedContainer) return;
    const cards = unmappedPeople.sort((a, b) => a.name.localeCompare(b.name)).map((person) => {
      const tag = person.url ? 'a' : 'div';
      const href = person.url ? ` href="${escapeHTML(person.url)}"` : '';
      return `
      <${tag} class="network-map__unmapped-person"${href}>
        <strong>${escapeHTML(person.name)}</strong>
        <span>${escapeHTML(person.affiliation || 'Affiliation not listed')}</span>
      </${tag}>`;
    }).join('');
    unmappedContainer.hidden = false;
    unmappedContainer.innerHTML = `
      <p class="eyebrow">Directory records awaiting location data</p>
      <h2>Additional members</h2>
      <p>These Members are included in the directory, but their country has not yet been recorded for the map.</p>
      <div class="network-map__unmapped-list">${cards}</div>`;
  };

  renderUnmapped();

  if (typeof window.L === 'undefined') {
    summary.textContent = 'The interactive map is temporarily unavailable.';
    renderEmptyPanel('The map library could not be loaded. You can still browse the Members directory.');
    return;
  }

  const map = window.L.map(canvas, {
    scrollWheelZoom: false,
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 8
  }).setView([25, 10], 2);

  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
  }).addTo(map);

  const markerLayer = window.L.layerGroup().addTo(map);
  const markers = new Map();

  sites.forEach((site) => {
    const marker = window.L.marker(site.coordinates, {
      icon: window.L.divIcon({
        html: `<span>${site.people.length}</span>`,
        className: 'network-map-marker',
        iconSize: [38, 38],
        iconAnchor: [19, 19]
      }),
      title: `${site.country}: ${site.people.length} ${site.people.length === 1 ? 'researcher' : 'researchers'}`
    });
    marker.bindTooltip(`${site.country} · ${site.people.length} ${site.people.length === 1 ? 'researcher' : 'researchers'}`, { direction: 'top', offset: [0, -16] });
    marker.on('click', () => renderSite(site));
    markers.set(site.country, marker);
  });

  const updateVisibleSites = () => {
    const query = search.value.trim().toLowerCase();
    const selectedCountry = countrySelect.value;
    const visibleSites = sites.filter((site) => {
      const haystack = [
        site.country,
        ...site.people.flatMap((person) => [person.name, person.affiliation, person.category])
      ].join(' ').toLowerCase();
      return (!selectedCountry || site.country === selectedCountry) && (!query || haystack.includes(query));
    });

    markerLayer.clearLayers();
    visibleSites.forEach((site) => markerLayer.addLayer(markers.get(site.country)));

    if (!visibleSites.length) {
      summary.textContent = 'No countries match the current search or filter.';
      renderEmptyPanel('No countries match the current search or filter. Try clearing the search or selecting a different country.');
      return;
    }

    const bounds = window.L.latLngBounds(visibleSites.map((site) => site.coordinates));
    if (visibleSites.length === 1) {
      map.setView(visibleSites[0].coordinates, 4);
      renderSite(visibleSites[0]);
    } else {
      map.fitBounds(bounds, { padding: [34, 34], maxZoom: 4 });
    }
    const count = visibleSites.reduce((total, site) => total + site.people.length, 0);
    summary.textContent = `Showing ${visibleSites.length} ${visibleSites.length === 1 ? 'country' : 'countries'} and ${count} ${count === 1 ? 'researcher' : 'researchers'}.`;
  };

  sites.forEach((site) => {
    const option = document.createElement('option');
    option.value = site.country;
    option.textContent = `${site.country} (${site.people.length})`;
    countrySelect.appendChild(option);
  });

  const resetMap = () => {
    search.value = '';
    countrySelect.value = '';
    renderEmptyPanel();
    updateVisibleSites();
  };

  search.addEventListener('input', updateVisibleSites);
  countrySelect.addEventListener('change', updateVisibleSites);
  reset.addEventListener('click', resetMap);

  updateVisibleSites();
  window.setTimeout(() => map.invalidateSize(), 120);
})();
