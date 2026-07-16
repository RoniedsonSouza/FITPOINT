/**
 * Mapa de unidades (fixas) + distribuidores (API).
 * Usado em index.html — callback global initMap para Google Maps.
 */

const FITPOINT_UNITS = [
  {
    name: 'Fit Point Fitness — Itacibá',
    lat: -20.32199,
    lng: -40.37817,
    primary: true,
    placeId: null,
    addr: 'R. Hugo Silveira, 04 — Itacibá, Cariacica/ES, 29150-250',
    routeBtn: 'btn-route-1',
    viewBtn: 'btn-view-1'
  },
  {
    name: 'Fit Point Fitness — Vila Bethania',
    lat: -20.360618,
    lng: -40.405477,
    placeId: null,
    addr: 'R. Cel. Nunes Ferreira, 84 — Vila Bethania, Viana/ES',
    routeBtn: 'btn-route-2',
    viewBtn: 'btn-view-2'
  }
];

const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#ebe3cd' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#523735' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f1e6' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e6f2ea' }] },
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#c9e7e4' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#f5f1e6' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#fdfcf8' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] }
];

let cachedDistributors = [];

function escapeHtmlMap(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttrMap(str) {
  return escapeHtmlMap(str).replace(/'/g, '&#39;');
}

function unitMarkerIconSvg(primary) {
  if (primary) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
      <circle cx="24" cy="22" r="18" fill="#F57C00" fill-opacity=".25"/>
      <path fill="#1D6B3A" d="M24 2C13.5 2 5 10.5 5 21c0 14.4 19 29 19 29s19-14.6 19-29C43 10.5 34.5 2 24 2z"/>
      <circle cx="24" cy="20" r="7" fill="#fff"/>
    </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">
    <path fill="#1D6B3A" d="M20 0C11.16 0 4 7.16 4 16c0 11.2 16 24 16 24s16-12.8 16-24C36 7.16 28.84 0 20 0z"/>
    <circle cx="20" cy="16" r="6" fill="#fff"/>
  </svg>`;
}

function distributorMarkerIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <path fill="#F57C00" d="M20 0C11.16 0 4 7.16 4 16c0 11.2 16 24 16 24s16-12.8 16-24C36 7.16 28.84 0 20 0z"/>
    <circle cx="20" cy="14" r="5" fill="#fff"/>
    <path fill="#fff" d="M11 26c1.8-4 5-6 9-6s7.2 2 9 6c-2.2 1.4-5.4 2.2-9 2.2S13.2 27.4 11 26z"/>
  </svg>`;
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function whatsappHref(whatsapp) {
  const digits = digitsOnly(whatsapp);
  if (!digits) return null;
  const withCountry = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${withCountry}`;
}

function instagramHref(instagram) {
  if (!instagram) return null;
  const raw = String(instagram).trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw.replace(/^@/, '');
  return `https://instagram.com/${encodeURIComponent(handle)}`;
}

function mapsSearchHref(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function distributorAvatarHtml(d) {
  if (d.photo_url) {
    return `<img class="distributor-avatar" src="${escapeAttrMap(d.photo_url)}" alt="${escapeAttrMap(d.name)}" loading="lazy">`;
  }
  const initial = (d.name || '?').trim().charAt(0).toUpperCase();
  return `<span class="distributor-avatar distributor-avatar--initial" aria-hidden="true">${escapeHtmlMap(initial)}</span>`;
}

function renderDistributorCards(distributors) {
  const section = document.getElementById('distributors-section');
  const container = document.getElementById('distributors-cards');
  if (!section || !container) return;

  if (!distributors.length) {
    section.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');
  container.innerHTML = distributors.map((d) => {
    const wa = whatsappHref(d.whatsapp);
    const ig = instagramHref(d.instagram);
    const maps = mapsSearchHref(d.lat, d.lng);
    const desc = d.description
      ? `<p class="distributor-description text-xs text-black/55 mt-2">${escapeHtmlMap(d.description)}</p>`
      : '';
    const buttons = [
      wa
        ? `<a class="distributor-action bg-fp-green text-white" href="${escapeAttrMap(wa)}" target="_blank" rel="noopener noreferrer">
            <i data-lucide="message-circle"></i> WhatsApp
          </a>`
        : '',
      ig
        ? `<a class="distributor-action border border-fp-green/30 text-fp-green" href="${escapeAttrMap(ig)}" target="_blank" rel="noopener noreferrer">
            <i data-lucide="instagram"></i> Instagram
          </a>`
        : '',
      `<a class="distributor-action border border-black/10 text-black/65" href="${escapeAttrMap(maps)}" target="_blank" rel="noopener noreferrer">
        <i data-lucide="map"></i> Maps
      </a>`
    ].filter(Boolean).join('');

    return `
      <article class="card distributor-card">
        <div class="flex items-center gap-3">
          ${distributorAvatarHtml(d)}
          <div class="min-w-0 flex-1">
            <span class="distributor-level-badge">${escapeHtmlMap(d.herbalife_level)}</span>
            <h2 class="font-semibold leading-tight mt-1 truncate">${escapeHtmlMap(d.name)}</h2>
          </div>
        </div>
        <p class="text-xs text-black/65 mt-3 flex items-center gap-1.5">
          <i data-lucide="map-pin" class="shrink-0"></i>
          <span class="truncate">${escapeHtmlMap(d.region_label)}</span>
          <span class="text-black/35 shrink-0">· aprox.</span>
        </p>
        ${desc}
        <div class="distributor-actions">${buttons}</div>
      </article>
    `;
  }).join('');

  try {
    window.lucide && window.lucide.createIcons();
  } catch (_) { /* ignore */ }
}

function distributorInfoHtml(d) {
  const photo = d.photo_url
    ? `<img src="${escapeAttrMap(d.photo_url)}" alt="" style="width:40px;height:40px;border-radius:999px;object-fit:cover;margin-right:8px;vertical-align:middle">`
    : '';
  const wa = whatsappHref(d.whatsapp);
  const links = [];
  if (wa) links.push(`<a href="${escapeAttrMap(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`);
  links.push(`<a href="${escapeAttrMap(mapsSearchHref(d.lat, d.lng))}" target="_blank" rel="noopener noreferrer">Ver no Maps</a>`);

  return `
    <div style="font-family:Inter,system-ui;max-width:240px">
      <div style="display:flex;align-items:center;margin-bottom:6px">
        ${photo}
        <div>
          <span style="display:inline-block;background:#F57C00;color:#fff;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600">${escapeHtmlMap(d.herbalife_level)}</span><br/>
          <strong>${escapeHtmlMap(d.name)}</strong>
        </div>
      </div>
      <small>${escapeHtmlMap(d.region_label)}</small><br/>
      <small style="color:#666">Localização aproximada</small><br/>
      ${links.join(' · ')}
    </div>
  `;
}

function initMap() {
  const units = FITPOINT_UNITS;
  const distributors = cachedDistributors;
  const mapEl = document.getElementById('map');
  if (!mapEl || typeof google === 'undefined' || !google.maps) return;

  const bounds = new google.maps.LatLngBounds();
  const map = new google.maps.Map(mapEl, {
    center: { lat: units[0].lat, lng: units[0].lng },
    zoom: 13,
    styles: MAP_STYLE,
    mapTypeControl: false,
    streetViewControl: false
  });

  const info = new google.maps.InfoWindow();

  units.forEach((loc) => {
    const primary = !!loc.primary;
    const mSize = primary ? 44 : 36;
    const anchorX = primary ? 22 : 18;
    const marker = new google.maps.Marker({
      position: { lat: loc.lat, lng: loc.lng },
      map,
      title: loc.name,
      zIndex: primary ? 1000 : 1,
      icon: {
        url: 'data:image/svg+xml;utf8,' + encodeURIComponent(unitMarkerIconSvg(primary)),
        scaledSize: new google.maps.Size(mSize, mSize),
        anchor: new google.maps.Point(anchorX, mSize)
      }
    });

    marker.addListener('click', () => {
      const badge = primary
        ? '<span style="display:inline-block;background:#1D6B3A;color:#fff;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;margin-bottom:6px">Unidade principal</span><br/>'
        : '';
      info.setContent(`
        <div style="font-family:Inter,system-ui">
          ${badge}<strong>${escapeHtmlMap(loc.name)}</strong><br/>
          <small>${escapeHtmlMap(loc.addr || '')}</small><br/>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}" target="_blank" rel="noopener noreferrer">Como chegar</a>
        </div>
      `);
      info.open(map, marker);
    });

    bounds.extend(marker.getPosition());

    const route = document.getElementById(loc.routeBtn);
    if (route) {
      route.href = `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`;
    }
    const view = document.getElementById(loc.viewBtn);
    if (view) {
      view.href = loc.placeId
        ? `https://www.google.com/maps/place/?q=place_id:${loc.placeId}`
        : mapsSearchHref(loc.lat, loc.lng);
    }
  });

  distributors.forEach((d) => {
    if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return;
    const marker = new google.maps.Marker({
      position: { lat: d.lat, lng: d.lng },
      map,
      title: d.name,
      zIndex: 500,
      icon: {
        url: 'data:image/svg+xml;utf8,' + encodeURIComponent(distributorMarkerIconSvg()),
        scaledSize: new google.maps.Size(36, 36),
        anchor: new google.maps.Point(18, 36)
      }
    });

    marker.addListener('click', () => {
      info.setContent(distributorInfoHtml(d));
      info.open(map, marker);
    });

    bounds.extend(marker.getPosition());
  });

  map.fitBounds(bounds);
}

window.initMap = initMap;

async function loadDistributorsForMap() {
  try {
    const response = await fetch('/api/distributors');
    if (!response.ok) throw new Error('Falha ao buscar distribuidores');
    cachedDistributors = await response.json();
    if (!Array.isArray(cachedDistributors)) cachedDistributors = [];
  } catch (error) {
    console.error('Erro ao carregar distribuidores:', error);
    cachedDistributors = [];
  }
  renderDistributorCards(cachedDistributors);
}

function loadGoogleMapsScript() {
  fetch('/api/config/google-maps-key')
    .then((res) => res.json())
    .then((data) => {
      if (data.key) {
        const script = document.createElement('script');
        script.async = true;
        script.defer = true;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${data.key}&callback=initMap`;
        document.head.appendChild(script);
      } else {
        console.error('Erro ao carregar Google Maps API Key:', data.error);
        const el = document.getElementById('map');
        if (el) el.innerHTML = '<p class="p-4 text-red-600">Erro ao carregar o mapa. Verifique a configuração da API.</p>';
      }
    })
    .catch((error) => {
      console.error('Erro ao carregar Google Maps API Key:', error);
      const el = document.getElementById('map');
      if (el) el.innerHTML = '<p class="p-4 text-red-600">Erro ao carregar o mapa.</p>';
    });
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    window.lucide && window.lucide.createIcons();
  } catch (_) { /* ignore */ }
  const y = document.getElementById('y');
  if (y) y.textContent = new Date().getFullYear();

  loadDistributorsForMap().finally(() => {
    loadGoogleMapsScript();
  });
});
