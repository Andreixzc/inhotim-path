// The page's words in Portuguese and English. Portuguese is the default for visitors whose browser
// asks for it; everyone else gets English. `t("key", {name: value})` fills in {name} placeholders.

const STRINGS = {
  "pt-BR": {
    title: "Roteiro no Inhotim",
    loading: "Carregando o mapa do parque…",
    loadError: "Não foi possível carregar os dados do parque. Tente novamente mais tarde.",
    from: "Partida",
    gate: "Portaria",
    myLocation: "Minha localização",
    locating: "Obtendo sua localização…",
    searching: "Calculando o caminho mais curto…",
    see: "O que ver",
    customize: "Personalizar",
    done: "Pronto",
    searchPlaceholder: "Buscar obra, galeria ou artista",
    noMatches: "Nada encontrado.",
    countOf: "{n} de {total}",
    addedN: { one: "{n} incluída", other: "{n} incluídas" },
    skippedN: { one: "{n} pulada", other: "{n} puladas" },
    stops: { one: "{n} parada", other: "{n} paradas" },
    route: "Roteiro",
    nextDoor: "Ao lado",
    start: "Início",
    finish: "Fim",
    youAreHere: "Você está aqui",
    skip: "Pular",
    add: "Incluir",
    // Stops marked as seen (ADR 0018).
    seenIt: "Já vi",
    unmark: "Desmarcar",
    markSeen: "Marcar {name} como vista",
    unmarkSeen: "Desmarcar {name}",
    seenTitle: "Já vistas",
    seenN: { one: "{n} vista", other: "{n} vistas" },
    seenStop: "Vista: {name}",
    seenTag: "vista",
    startOver: "Começar de novo",
    startOverConfirm: "Apagar todas as marcações de “já vi”?",
    leftOff: "Onde você parou",
    continuingFrom: "Continuando de {name}, a última que você viu.",
    suggest: "Você está em {name}. Já viu?",
    allSeen: "Você já viu tudo o que escolheu.",
    officialPage: "Página oficial",
    unreachable: "Fora dos caminhos conhecidos (não entram no roteiro): {names}.",
    noStops: "Nada para visitar com essas escolhas.",
    planFailed: "Algo deu errado ao calcular o roteiro.",
    outsideTitle: "Você está fora do Inhotim",
    outsideBody: "Sua localização fica a {distance} do parque. O roteiro começa na portaria.",
    geoFailedTitle: "Não foi possível obter sua localização",
    geoFailedBody:
      "Verifique se o navegador pode usar sua localização. O roteiro começa na portaria.",
    dismiss: "Fechar",
    satellite: "Satélite",
    map: "Mapa",
    satelliteUnavailable: "Imagens de satélite indisponíveis",
    showPlan: "Ver roteiro",
    showMap: "Ver mapa",
    language: "EN",
    languageName: "English",
    dataFrom: "Dados do mapa de {date}.",
    disclaimer: "Confira os horários de funcionamento em inhotim.org.br.",
    notAffiliated: "Projeto independente, sem vínculo com o Inhotim.",
    sourceCode: "Código-fonte",
    // The museum's own words for its categories (the filters on inhotim.org.br/mapa).
    kinds: {
      gallery: "Galerias",
      outdoor_work: "Obras a céu aberto",
      garden: "Jardins temáticos",
      botanical: "Destaques botânicos",
      artist: "Artistas",
      other: "Outros",
    },
    kind: {
      gallery: "Galeria",
      outdoor_work: "Obra a céu aberto",
      garden: "Jardim temático",
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
    loading: "Loading the park map…",
    loadError: "Couldn't load the park data. Please try again later.",
    from: "Start from",
    gate: "Entrance",
    myLocation: "My location",
    locating: "Getting your location…",
    searching: "Finding the shortest walk…",
    see: "What to see",
    customize: "Customize",
    done: "Done",
    searchPlaceholder: "Search a work, gallery or artist",
    noMatches: "No matches.",
    countOf: "{n} of {total}",
    addedN: { one: "{n} added", other: "{n} added" },
    skippedN: { one: "{n} skipped", other: "{n} skipped" },
    stops: { one: "{n} stop", other: "{n} stops" },
    route: "Route",
    nextDoor: "Next door",
    start: "Start",
    finish: "Finish",
    youAreHere: "You are here",
    skip: "Skip",
    add: "Add",
    seenIt: "Seen it",
    unmark: "Unmark",
    markSeen: "Mark {name} as seen",
    unmarkSeen: "Unmark {name}",
    seenTitle: "Seen",
    seenN: { one: "{n} seen", other: "{n} seen" },
    seenStop: "Seen: {name}",
    seenTag: "seen",
    startOver: "Start over",
    startOverConfirm: "Clear every stop marked as seen?",
    leftOff: "Where you left off",
    continuingFrom: "Continuing from {name}, the last one you saw.",
    suggest: "You're at {name}. Seen it?",
    allSeen: "You've seen everything you chose.",
    officialPage: "Official page",
    unreachable: "Off the known paths (not routed): {names}.",
    noStops: "Nothing to visit with these choices.",
    planFailed: "Something went wrong while planning the route.",
    outsideTitle: "You're not at Inhotim",
    outsideBody: "Your location is {distance} from the park. The route starts at the entrance.",
    geoFailedTitle: "Couldn't get your location",
    geoFailedBody:
      "Check that the browser may use your location. The route starts at the entrance.",
    dismiss: "Dismiss",
    satellite: "Satellite",
    map: "Map",
    satelliteUnavailable: "Satellite imagery unavailable",
    showPlan: "Show route",
    showMap: "Show map",
    language: "PT",
    languageName: "Português",
    dataFrom: "Map data from {date}.",
    disclaimer: "Check opening hours at inhotim.org.br.",
    notAffiliated: "An independent project, not affiliated with Inhotim.",
    sourceCode: "Source code",
    // As on the museum's English map, except "Open-air construction" there, a mistranslation.
    kinds: {
      gallery: "Galleries",
      outdoor_work: "Open-air works",
      garden: "Themed gardens",
      botanical: "Botanical highlights",
      artist: "Artists",
      other: "Other",
    },
    kind: {
      gallery: "Gallery",
      outdoor_work: "Open-air work",
      garden: "Themed garden",
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
