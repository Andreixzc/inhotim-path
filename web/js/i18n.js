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
    kinds: {
      gallery: "Galerias",
      outdoor_work: "Obras ao ar livre",
      garden: "Jardins",
      botanical: "Destaques botânicos",
      other: "Outros",
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
    loading: "Loading the park map…",
    loadError: "Couldn't load the park data. Please try again later.",
    from: "Start from",
    gate: "Entrance",
    myLocation: "My location",
    locating: "Getting your location…",
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
    kinds: {
      gallery: "Galleries",
      outdoor_work: "Outdoor works",
      garden: "Gardens",
      botanical: "Botanical highlights",
      other: "Other",
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
