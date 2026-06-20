// ═══════════════════════════════════════════════════════════════════════
// SHARED PLAYER DATA — The Inner Sanctum
// Single source of truth for the fallback player pool, used by both
// draft.html and tiers.html (backlog #97 — these used to be two
// independently hand-maintained copies that had drifted out of sync,
// with different ADP scales and different stale team assignments).
//
// IMPORTANT: the `team` field below is a LAST-RESORT value only, used
// if a live team lookup isn't available. Both pages call
// fetchSleeperTeamMap() + applyLiveTeams() to correct team assignments
// against Sleeper's live roster data first. Reconciled and verified
// June 2026 — see Session 10 notes for the specific corrections made
// (Geno Smith, Kyler Murray, Aaron Rodgers, Daniel Jones, Justin Fields,
// Sam Darnold, Gardner Minshew, Zach Wilson, Davante Adams, Stefon Diggs
// were all stale in at least one of the two old lists; Derek Carr and
// Russell Wilson were removed — Carr is retired, Wilson is not on a
// roster). Team abbreviations standardized to JAX / WAS (matches
// Sleeper's own convention).
// ═══════════════════════════════════════════════════════════════════════

var PLAYER_POOL = {
QB:[
  {name:'Lamar Jackson',team:'BAL',adp:1.2},{name:'Josh Allen',team:'BUF',adp:2.1},
  {name:'Jalen Hurts',team:'PHI',adp:3.8},{name:'Joe Burrow',team:'CIN',adp:7.4},
  {name:'C.J. Stroud',team:'HOU',adp:10.2},{name:'Dak Prescott',team:'DAL',adp:11.8},
  {name:'Anthony Richardson',team:'IND',adp:14.5},{name:'Tua Tagovailoa',team:'ATL',adp:16.3},
  {name:'Jordan Love',team:'GB',adp:19.1},{name:'Sam Darnold',team:'SEA',adp:21.6},
  {name:'Kyler Murray',team:'MIN',adp:24.4},{name:'Baker Mayfield',team:'TB',adp:27.3},
  {name:'Justin Fields',team:'KC',adp:38.5},{name:'Geno Smith',team:'NYJ',adp:42.1},
  {name:'Caleb Williams',team:'CHI',adp:46.0},{name:'Jayden Daniels',team:'WAS',adp:49.7},
  {name:'Drake Maye',team:'NE',adp:55.3},{name:'Bo Nix',team:'DEN',adp:61.2},
  {name:'Brock Purdy',team:'SF',adp:65.8},{name:'Trevor Lawrence',team:'JAX',adp:69.4},
  {name:'Kirk Cousins',team:'LV',adp:73.1},{name:'Matthew Stafford',team:'LAR',adp:77.8},
  {name:'Patrick Mahomes',team:'KC',adp:82.2},{name:'Deshaun Watson',team:'CLE',adp:86.5},
  {name:'Aaron Rodgers',team:'PIT',adp:91.0},{name:'Jared Goff',team:'DET',adp:95.3},
  {name:'Daniel Jones',team:'IND',adp:99.8},{name:'Zach Wilson',team:'NO',adp:104.2},
  {name:'Gardner Minshew',team:'ARI',adp:108.7},{name:'Bryce Young',team:'CAR',adp:113.1},
  {name:'Hendon Hooker',team:'DET',adp:118.4},{name:'Desmond Ridder',team:'ARI',adp:123.6},
  {name:'Sam Howell',team:'WAS',adp:128.9},{name:'Will Levis',team:'TEN',adp:134.2},
  {name:'Michael Penix Jr.',team:'ATL',adp:139.5},{name:'Malik Willis',team:'TEN',adp:144.8},
  {name:'Tanner McKee',team:'PHI',adp:150.1},{name:'Jake Haener',team:'NO',adp:155.4}
],
RB:[
  {name:'Christian McCaffrey',team:'SF',adp:1.0},{name:'Breece Hall',team:'NYJ',adp:2.9},
  {name:'Bijan Robinson',team:'ATL',adp:4.2},{name:'Jahmyr Gibbs',team:'DET',adp:6.3},
  {name:'Jonathan Taylor',team:'IND',adp:8.8},{name:'Saquon Barkley',team:'PHI',adp:11.1},
  {name:"De'Von Achane",team:'MIA',adp:12.7},{name:'Josh Jacobs',team:'GB',adp:14.4},
  {name:'Tony Pollard',team:'TEN',adp:17.8},{name:'Rachaad White',team:'TB',adp:20.5},
  {name:'James Cook',team:'BUF',adp:23.1},{name:'Kyren Williams',team:'LAR',adp:25.6},
  {name:'Joe Mixon',team:'HOU',adp:28.9},{name:'Travis Etienne',team:'JAX',adp:31.4},
  {name:'Derrick Henry',team:'BAL',adp:33.7},{name:'Rhamondre Stevenson',team:'NE',adp:37.2},
  {name:'Aaron Jones',team:'MIN',adp:40.8},{name:'Isiah Pacheco',team:'KC',adp:43.5},
  {name:"D'Andre Swift",team:'CHI',adp:47.1},{name:'Zamir White',team:'LV',adp:50.6},
  {name:'Brian Robinson Jr.',team:'WAS',adp:54.3},{name:'Zach Charbonnet',team:'SEA',adp:57.9},
  {name:'David Montgomery',team:'DET',adp:61.2},{name:'Jaleel McLaughlin',team:'DEN',adp:65.8},
  {name:'Raheem Mostert',team:'MIA',adp:69.4},{name:'Gus Edwards',team:'LAC',adp:73.1},
  {name:'Devin Singletary',team:'NYG',adp:76.8},{name:'Dameon Pierce',team:'HOU',adp:80.5},
  {name:'Tyler Allgeier',team:'ATL',adp:84.2},{name:'Jerome Ford',team:'CLE',adp:88.6},
  {name:'Kareem Hunt',team:'KC',adp:92.3},{name:'Miles Sanders',team:'CAR',adp:96.8},
  {name:'Tyjae Spears',team:'TEN',adp:101.1},{name:'Jaylen Warren',team:'PIT',adp:105.4},
  {name:'AJ Dillon',team:'GB',adp:109.7},{name:'Clyde Edwards-Helaire',team:'KC',adp:113.9},
  {name:'Elijah Mitchell',team:'SF',adp:118.2},{name:'Hassan Haskins',team:'LAR',adp:122.6},
  {name:'Roschon Johnson',team:'CHI',adp:126.9},{name:'Ty Chandler',team:'MIN',adp:131.3},
  {name:'Kenny McIntosh',team:'WAS',adp:135.6},{name:'Patrick Taylor',team:'GB',adp:139.9},
  {name:'Eric Gray',team:'NYG',adp:144.2},{name:'Antonio Gibson',team:'NE',adp:148.5},
  {name:'Keaton Mitchell',team:'BAL',adp:152.8},{name:'Ezekiel Elliott',team:'DAL',adp:157.1},
  {name:'MarShawn Lloyd',team:'SF',adp:161.4},{name:'Tank Bigsby',team:'JAX',adp:165.7},
  {name:'Chris Rodriguez Jr.',team:'WAS',adp:170.0},{name:'Kimani Vidal',team:'LAC',adp:174.3},
  {name:'Emari Demercado',team:'ARI',adp:178.6},{name:'Samaje Perine',team:'DEN',adp:182.9},
  {name:'Justice Hill',team:'BAL',adp:187.2},{name:'Cam Akers',team:'MIN',adp:191.5},
  {name:'Rashaad Penny',team:'PHI',adp:195.8},{name:'Tyrion Davis-Price',team:'SF',adp:204.4},
  {name:'Caleb Huntley',team:'ATL',adp:213.0},{name:'Dare Ogunbowale',team:'HOU',adp:217.3},
  {name:'Eno Benjamin',team:'ARI',adp:221.6},{name:'Evan Hull',team:'IND',adp:234.5},
  {name:'Kendre Miller',team:'NO',adp:238.8},{name:'Zonovan Knight',team:'NYJ',adp:264.6},
  {name:'Trayveon Williams',team:'CIN',adp:268.9},{name:'Jermar Jefferson',team:'DET',adp:273.2},
  {name:'Salvon Ahmed',team:'MIA',adp:277.5},{name:'Joshua Kelley',team:'LAC',adp:281.8},
  {name:'Spencer Brown',team:'BUF',adp:290.4},
  {name:'John Kelly',team:'LAR',adp:294.7},{name:'Tavion Thomas',team:'CIN',adp:299.0},
  {name:'Craig Reynolds',team:'DET',adp:251.7},{name:'Ty Montgomery',team:'NE',adp:260.3},
  {name:'Qadree Ollison',team:'ATL',adp:256.0},{name:'Hassan Hall',team:'SF',adp:243.1},
  {name:'Dontayvion Wicks',team:'GB',adp:200.1},{name:'Malik Davis',team:'DAL',adp:225.9},
  {name:'Elijah Dotson',team:'CAR',adp:230.2}
],
WR:[
  {name:'CeeDee Lamb',team:'DAL',adp:1.8},{name:"Ja'Marr Chase",team:'CIN',adp:3.1},
  {name:'Tyreek Hill',team:'MIA',adp:5.6},{name:'Justin Jefferson',team:'MIN',adp:6.9},
  {name:'Davante Adams',team:'NYJ',adp:9.3},{name:'Stefon Diggs',team:'HOU',adp:12.4},
  {name:'A.J. Brown',team:'PHI',adp:13.8},{name:'Amon-Ra St. Brown',team:'DET',adp:15.2},
  {name:'DeVonta Smith',team:'PHI',adp:17.6},{name:'Drake London',team:'ATL',adp:19.4},
  {name:'Jaylen Waddle',team:'MIA',adp:22.1},{name:'Chris Olave',team:'NO',adp:24.8},
  {name:'Puka Nacua',team:'LAR',adp:27.3},{name:'Mike Evans',team:'TB',adp:29.7},
  {name:'Tee Higgins',team:'CIN',adp:32.5},{name:'Terry McLaurin',team:'WAS',adp:35.1},
  {name:'Garrett Wilson',team:'NYJ',adp:38.8},{name:'Christian Kirk',team:'JAX',adp:41.9},
  {name:'Zay Flowers',team:'BAL',adp:44.3},{name:'Tank Dell',team:'HOU',adp:47.6},
  {name:'George Pickens',team:'PIT',adp:50.2},{name:'Michael Pittman Jr.',team:'IND',adp:53.8},
  {name:'Keenan Allen',team:'CHI',adp:57.4},{name:'Calvin Ridley',team:'TEN',adp:60.1},
  {name:'Brandon Aiyuk',team:'SF',adp:63.5},{name:'Deebo Samuel',team:'SF',adp:67.2},
  {name:'Diontae Johnson',team:'CAR',adp:71.0},{name:'Rashee Rice',team:'KC',adp:74.6},
  {name:'Romeo Doubs',team:'GB',adp:78.3},{name:"Ja'Lynn Polk",team:'NE',adp:82.0},
  {name:'Courtland Sutton',team:'DEN',adp:85.7},{name:'Jaxon Smith-Njigba',team:'SEA',adp:89.4},
  {name:'Xavier Legette',team:'CAR',adp:93.1},{name:'Josh Downs',team:'IND',adp:96.8},
  {name:'Marvin Harrison Jr.',team:'ARI',adp:100.5},{name:'Rome Odunze',team:'CHI',adp:104.2},
  {name:'Quentin Johnston',team:'LAC',adp:107.9},{name:'Odell Beckham Jr.',team:'MIA',adp:111.6},
  {name:'Jerry Jeudy',team:'CLE',adp:115.3},{name:'Gabe Davis',team:'JAX',adp:119.0},
  {name:'DJ Moore',team:'CHI',adp:122.7},{name:'Tyler Lockett',team:'SEA',adp:126.4},
  {name:'Adam Thielen',team:'CAR',adp:130.1},{name:'Khalil Shakir',team:'BUF',adp:133.8},
  {name:'Demario Douglas',team:'NE',adp:137.5},{name:'Van Jefferson',team:'ATL',adp:141.2},
  {name:'Noah Brown',team:'HOU',adp:144.9},{name:'Darius Slayton',team:'NYG',adp:148.6},
  {name:'KJ Osborn',team:'NE',adp:152.3},{name:'Elijah Moore',team:'CLE',adp:156.0},
  {name:'Cedrick Wilson Jr.',team:'NO',adp:159.7},{name:'Marquise Brown',team:'ARI',adp:163.4},
  {name:'Skyy Moore',team:'KC',adp:167.1},{name:'Alec Pierce',team:'IND',adp:170.8},
  {name:'Michael Wilson',team:'ARI',adp:174.5},{name:'Darnell Mooney',team:'ATL',adp:181.9},
  {name:'Tutu Atwell',team:'LAR',adp:189.3},{name:'Donovan Peoples-Jones',team:'CLE',adp:196.7},
  {name:'Hunter Renfrow',team:'LV',adp:200.4},{name:'Nelson Agholor',team:'BAL',adp:207.8},
  {name:'Kendrick Bourne',team:'NE',adp:211.5},{name:'Mecole Hardman',team:'KC',adp:230.0},
  {name:'JuJu Smith-Schuster',team:'NE',adp:233.7},{name:'Kyle Philips',team:'TEN',adp:241.1},
  {name:'Trent Sherfield',team:'BUF',adp:244.8},{name:'Chris Moore',team:'HOU',adp:255.9},
  {name:'Dez Fitzpatrick',team:'TEN',adp:263.3},{name:'Marcus Johnson',team:'IND',adp:267.0},
  {name:'Isaiah McKenzie',team:'IND',adp:226.3},{name:'Dee Eskridge',team:'SEA',adp:237.4},
  {name:'Velus Jones Jr.',team:'CHI',adp:218.9},{name:'Phillip Dorsett',team:'TEN',adp:222.6},
  {name:'Jalen Reagor',team:'NYJ',adp:215.2},{name:'Robbie Chosen',team:'NE',adp:204.1},
  {name:'Anthony Schwartz',team:'PIT',adp:193.0},{name:'Kadarius Toney',team:'KC',adp:185.6},
  {name:'Andy Isabella',team:'ARI',adp:259.6},{name:'Kevin Harmon',team:'SEA',adp:252.2}
],
TE:[
  {name:'Travis Kelce',team:'KC',adp:4.5},{name:'Sam LaPorta',team:'DET',adp:9.2},
  {name:'Mark Andrews',team:'BAL',adp:13.7},{name:'Trey McBride',team:'ARI',adp:16.8},
  {name:'Dallas Goedert',team:'PHI',adp:21.4},{name:'Evan Engram',team:'JAX',adp:26.9},
  {name:'David Njoku',team:'CLE',adp:32.1},{name:'Kyle Pitts',team:'ATL',adp:37.8},
  {name:'Jake Ferguson',team:'DAL',adp:44.2},{name:'Cole Kmet',team:'CHI',adp:50.6},
  {name:'Tucker Kraft',team:'GB',adp:57.3},{name:'Dalton Kincaid',team:'BUF',adp:63.1},
  {name:'Isaiah Likely',team:'BAL',adp:68.9},{name:'Chigoziem Okonkwo',team:'TEN',adp:74.2},
  {name:'Gerald Everett',team:'LAC',adp:79.8},{name:'Cade Otton',team:'TB',adp:85.4},
  {name:'Tyler Higbee',team:'LAR',adp:91.1},{name:'Mike Gesicki',team:'NE',adp:96.7},
  {name:'Logan Thomas',team:'WAS',adp:102.3},{name:'Hunter Henry',team:'NE',adp:107.9},
  {name:'Noah Fant',team:'SEA',adp:113.5},{name:'Juwan Johnson',team:'NO',adp:119.1},
  {name:'Josh Oliver',team:'MIN',adp:124.7},{name:'Greg Dulcich',team:'DEN',adp:130.3},
  {name:'Tyler Conklin',team:'NYJ',adp:135.9},{name:'Irv Smith Jr.',team:'CIN',adp:141.5},
  {name:'Brevin Jordan',team:'HOU',adp:147.1},{name:'Adam Trautman',team:'DEN',adp:152.7},
  {name:'Drew Sample',team:'CIN',adp:158.3},{name:'Durham Smythe',team:'MIA',adp:163.9},
  {name:'Mo Alie-Cox',team:'IND',adp:169.5},{name:'Tommy Hudson',team:'ARI',adp:175.1},
  {name:'Nick Vannett',team:'NO',adp:180.7},{name:'Josiah Deguara',team:'GB',adp:186.3},
  {name:'Matt Bushman',team:'PHI',adp:191.9},{name:'Tanner McLachlan',team:'ARI',adp:197.5},
  {name:'Nate Wieting',team:'DET',adp:203.1},{name:'Brayden Willis',team:'SF',adp:208.7},
  {name:'Charlie Woerner',team:'SF',adp:214.3},{name:'Pharaoh Brown',team:'HOU',adp:219.9}
],
K:[
  {name:'Justin Tucker',team:'BAL',adp:2.1},{name:'Evan McPherson',team:'CIN',adp:4.8},
  {name:'Tyler Bass',team:'BUF',adp:7.2},{name:'Brandon Aubrey',team:'DAL',adp:9.6},
  {name:'Jake Elliott',team:'PHI',adp:12.3},{name:'Harrison Butker',team:'KC',adp:15.1},
  {name:'Jake Moody',team:'SF',adp:18.7},{name:'Cameron Dicker',team:'LAC',adp:22.4},
  {name:'Greg Zuerlein',team:'NYJ',adp:26.9},{name:'Wil Lutz',team:'DEN',adp:31.5},
  {name:'Matt Gay',team:'IND',adp:36.1},{name:'Jason Sanders',team:'MIA',adp:40.8},
  {name:'Cairo Santos',team:'CHI',adp:45.4},{name:'Chase McLaughlin',team:'CLE',adp:50.0},
  {name:'Younghoe Koo',team:'ATL',adp:54.6},{name:'Robbie Gould',team:'SF',adp:59.2},
  {name:'Nick Folk',team:'TEN',adp:63.8},{name:'Ryan Succop',team:'TB',adp:68.4},
  {name:'Eddy Pineiro',team:'CAR',adp:73.0},{name:'Dustin Hopkins',team:'CLE',adp:77.6},
  {name:'Daniel Carlson',team:'LV',adp:82.2},{name:'Chris Boswell',team:'PIT',adp:86.8},
  {name:'Matt Prater',team:'ARI',adp:91.4},{name:'Rodrigo Blankenship',team:'IND',adp:96.0},
  {name:'Cade York',team:'CLE',adp:100.6},{name:'Riley Patterson',team:'JAX',adp:105.2},
  {name:'Graham Gano',team:'NYG',adp:109.8},{name:"Ka'imi Fairbairn",team:'HOU',adp:114.4},
  {name:'Brett Maher',team:'DAL',adp:119.0},{name:'Josh Lambo',team:'WAS',adp:123.6},
  {name:'Joe Vizcaino',team:'ATL',adp:128.2},{name:'Trenton Gill',team:'CHI',adp:132.8}
],
DEF:[
  {name:'San Francisco 49ers',team:'SF',adp:3.2},{name:'Dallas Cowboys',team:'DAL',adp:6.7},
  {name:'Baltimore Ravens',team:'BAL',adp:9.1},{name:'New England Patriots',team:'NE',adp:12.6},
  {name:'Philadelphia Eagles',team:'PHI',adp:15.4},{name:'Buffalo Bills',team:'BUF',adp:18.9},
  {name:'Kansas City Chiefs',team:'KC',adp:22.3},{name:'Cleveland Browns',team:'CLE',adp:26.8},
  {name:'Pittsburgh Steelers',team:'PIT',adp:30.5},{name:'Miami Dolphins',team:'MIA',adp:34.1},
  {name:'New York Jets',team:'NYJ',adp:37.8},{name:'Cincinnati Bengals',team:'CIN',adp:41.4},
  {name:'Minnesota Vikings',team:'MIN',adp:45.0},{name:'Green Bay Packers',team:'GB',adp:48.7},
  {name:'Los Angeles Rams',team:'LAR',adp:52.3},{name:'Jacksonville Jaguars',team:'JAX',adp:56.0},
  {name:'Denver Broncos',team:'DEN',adp:59.6},{name:'Seattle Seahawks',team:'SEA',adp:63.2},
  {name:'Detroit Lions',team:'DET',adp:66.9},{name:'Tampa Bay Buccaneers',team:'TB',adp:70.5},
  {name:'Indianapolis Colts',team:'IND',adp:74.1},{name:'New Orleans Saints',team:'NO',adp:77.8},
  {name:'Houston Texans',team:'HOU',adp:81.4},{name:'Los Angeles Chargers',team:'LAC',adp:85.0},
  {name:'Arizona Cardinals',team:'ARI',adp:88.7},{name:'Atlanta Falcons',team:'ATL',adp:92.3},
  {name:'Washington Commanders',team:'WAS',adp:95.9},{name:'Tennessee Titans',team:'TEN',adp:99.6},
  {name:'Chicago Bears',team:'CHI',adp:103.2},{name:'Las Vegas Raiders',team:'LV',adp:106.8},
  {name:'Carolina Panthers',team:'CAR',adp:110.5},{name:'New York Giants',team:'NYG',adp:114.1}
]
};

// ── Name normalization (for matching our pool against Sleeper names) ──
// Strips punctuation, suffixes (Jr/Sr/II/III/IV), and collapses spacing
// so "C.J. Stroud" / "CJ Stroud" / "Patrick Taylor Jr." all match
// consistently.
function normalizePlayerName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[.''']/g, '')
    .replace(/-/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Fetch Sleeper's live player list and build a name -> team map ──
// Returns null on any failure so callers can gracefully keep whatever
// static team value they already have. DEF entries are intentionally
// not covered here — a team's own defense can't be "traded," so the
// hardcoded team in PLAYER_POOL.DEF never goes stale.
async function fetchSleeperTeamMap() {
  try {
    var res = await fetch('https://api.sleeper.app/v1/players/nfl');
    var data = await res.json();
    var map = {};
    Object.values(data).forEach(function (p) {
      if (!p.full_name || !p.team) return;
      map[normalizePlayerName(p.full_name)] = p.team;
    });
    return map;
  } catch (e) {
    return null;
  }
}

// ── Apply a Sleeper team map over a position's player array ──
// Returns a new array; does not mutate the input. Any player Sleeper
// doesn't have a live match for keeps their existing team value.
function applyLiveTeams(players, teamMap) {
  if (!teamMap) return players;
  return players.map(function (p) {
    var liveTeam = teamMap[normalizePlayerName(p.name)];
    if (!liveTeam || liveTeam === p.team) return p;
    var copy = {};
    for (var k in p) copy[k] = p[k];
    copy.team = liveTeam;
    return copy;
  });
}

// Expose globally for plain <script> includes (no module system in this
// project's GitHub-web-editor workflow).
window.PLAYER_POOL = PLAYER_POOL;
window.normalizePlayerName = normalizePlayerName;
window.fetchSleeperTeamMap = fetchSleeperTeamMap;
window.applyLiveTeams = applyLiveTeams;
