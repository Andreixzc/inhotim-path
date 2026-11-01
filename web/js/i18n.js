// The page's words in Portuguese and English. Portuguese is the default for visitors whose browser
// asks for it; everyone else gets English. `t("key", {name: value})` fills in {name} placeholders.

const STRINGS = {
  "pt-BR": {
    title: "Roteiro no Inhotim",
    tagline: "O melhor percurso a pé para o tempo que você tem.",
    loading: "Carregando o mapa do parque…",
    loadError: "Não foi possível carregar os dados do parque. Tente novamente mais tarde.",
    planning: "Calculando…",
    timeAvailable: "Tempo disponível",
    everything: "Ver tudo",
    hours: "{h} h",
    hoursMinutes: "{h} h {m}",
    startAt: "Início às",
    startFrom: "Sair de",
    reception: "Recepção",
    myLocation: "Minha localização",
    whatToSee: "O que ver",
    mustSees: "Imperdíveis",
    mustSeesHint: "Entram no roteiro mesmo com pouco tempo.",
    searchPlaceholder: "Busque obra, galeria ou artista",
    noMatches: "Nada encontrado.",
    remove: "Remover {name}",
    moreOptions: "Mais opções",
    pace: "Ritmo de caminhada",
    relaxed: "Tranquilo (3 km/h)",
    normal: "Normal (4 km/h)",
    brisk: "Rápido (5 km/h)",
    minutesAt: "Minutos em cada parada",
    summary: "{stops} · {total} · {walk} a pé ({walkTime})",
    endsAt: "termina às {time}",
    stops: { one: "{n} parada", other: "{n} paradas" },
    walkLeg: "{time} a pé · {distance}",
    nextDoor: "Logo ao lado",
    start: "Início",
    finish: "Fim",
    youAreHere: "Você está aqui",
    minutesHere: "{min} min",
    skip: "Pular",
    restore: "Restaurar",
    add: "Incluir",
    officialPage: "Página oficial",
    mustSee: "Imperdível",
    addMust: "Marcar como imperdível",
    removeMust: "Desmarcar imperdível",
    leftOut: {
      one: "{n} ficou de fora por falta de tempo",
      other: "{n} ficaram de fora por falta de tempo",
    },
    skippedByYou: { one: "{n} pulada por você", other: "{n} puladas por você" },
    unreachable: "Fora dos caminhos conhecidos (não entram no roteiro): {names}.",
    infeasible: "Os imperdíveis não cabem em {budget}: este roteiro leva {total}.",
    noStops: "Escolha ao menos um tipo de parada ou um imperdível.",
    farAway:
      "Você parece estar fora do parque (a {distance} dos caminhos). O roteiro sai da recepção.",
    geoFailed: "Não foi possível obter sua localização. O roteiro sai da recepção.",
    planFailed: "Algo deu errado ao calcular o roteiro.",
    satellite: "Satélite",
    map: "Mapa",
    satelliteUnavailable: "Imagens de satélite indisponíveis",
    showPlan: "Ver roteiro",
    hidePlan: "Ver mapa",
    language: "English",
    dataFrom: "Dados do mapa de {date}.",
    disclaimer: "Os tempos são estimativas. Confira horários em inhotim.org.br.",
    notAffiliated: "Projeto independente, sem vínculo com o Inhotim.",
    sourceCode: "Código-fonte",
    kinds: {
      gallery: "Galerias",
      outdoor_work: "Obras ao ar livre",
      garden: "Jardins",
      botanical: "Destaques botânicos",
    },
    kind: {
      gallery: "Galeria",
      outdoor_work: "Obra ao ar livre",
      garden: "Jardim",
      botanical: "Destaque botânico",
      exhibition: "Exposição",
      work_in_gallery: "Obra em galeria",
      service: "Serviço",
      event: "Programação",
      other: "Outro",
    },
  },
  en: {
    title: "Inhotim route planner",
    tagline: "The best walk for the time you have.",
    loading: "Loading the park map…",
    loadError: "Couldn't load the park data. Please try again later.",
    planning: "Planning…",
    timeAvailable: "Time available",
    everything: "See everything",
    hours: "{h} h",
    hoursMinutes: "{h} h {m}",
    startAt: "Start at",
    startFrom: "Start from",
    reception: "Reception",
    myLocation: "My location",
    whatToSee: "What to see",
    mustSees: "Must-sees",
    mustSeesHint: "Always in the route, however short the time.",
    searchPlaceholder: "Search a work, gallery or artist",
    noMatches: "No matches.",
    remove: "Remove {name}",
    moreOptions: "More options",
    pace: "Walking pace",
    relaxed: "Relaxed (3 km/h)",
    normal: "Normal (4 km/h)",
    brisk: "Brisk (5 km/h)",
    minutesAt: "Minutes at each stop",
    summary: "{stops} · {total} · {walk} walking ({walkTime})",
    endsAt: "ends at {time}",
    stops: { one: "{n} stop", other: "{n} stops" },
    walkLeg: "{time} walk · {distance}",
    nextDoor: "Right next door",
    start: "Start",
    finish: "Finish",
    youAreHere: "You are here",
    minutesHere: "{min} min",
    skip: "Skip",
    restore: "Restore",
    add: "Add",
    officialPage: "Official page",
    mustSee: "Must-see",
    addMust: "Make it a must-see",
    removeMust: "Not a must-see",
    leftOut: { one: "{n} left out for lack of time", other: "{n} left out for lack of time" },
    skippedByYou: { one: "{n} skipped by you", other: "{n} skipped by you" },
    unreachable: "Off the known paths (not routed): {names}.",
    infeasible: "Your must-sees don't fit in {budget}: this route takes {total}.",
    noStops: "Pick at least one kind of stop or a must-see.",
    farAway:
      "You seem to be outside the park ({distance} from the paths). " +
      "The route starts at the reception.",
    geoFailed: "Couldn't get your location. The route starts at the reception.",
    planFailed: "Something went wrong while planning the route.",
    satellite: "Satellite",
    map: "Map",
    satelliteUnavailable: "Satellite imagery unavailable",
    showPlan: "Show plan",
    hidePlan: "Show map",
    language: "Português",
    dataFrom: "Map data from {date}.",
    disclaimer: "Times are estimates. Check opening hours at inhotim.org.br.",
    notAffiliated: "An independent project, not affiliated with Inhotim.",
    sourceCode: "Source code",
    kinds: {
      gallery: "Galleries",
      outdoor_work: "Outdoor works",
      garden: "Gardens",
      botanical: "Botanical highlights",
    },
    kind: {
      gallery: "Gallery",
      outdoor_work: "Outdoor work",
      garden: "Garden",
      botanical: "Botanical highlight",
      exhibition: "Exhibition",
      work_in_gallery: "Work in a gallery",
      service: "Service",
      event: "Event",
      other: "Other",
    },
  },
};

export const LANGUAGES = Object.keys(STRINGS);
let current = "en";

/** Portuguese for browsers that prefer it, else English; a saved choice wins. */
export function detect(saved, preferred = []) {
  if (LANGUAGES.includes(saved)) return saved;
  return preferred.some((tag) => tag.toLowerCase().startsWith("pt")) ? "pt-BR" : "en";
}

export function setLang(lang) {
  current = LANGUAGES.includes(lang) ? lang : "en";
}

export function lang() {
  return current;
}

/** The text for `key` (a dotted path for nested ones), with {placeholders} filled in. */
export function t(key, vars = {}) {
  let entry = key.split(".").reduce((node, part) => node?.[part], STRINGS[current]);
  if (entry && typeof entry === "object" && "other" in entry) {
    entry = vars.n === 1 ? entry.one : entry.other;
  }
  if (typeof entry !== "string") return key;
  return entry.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}
