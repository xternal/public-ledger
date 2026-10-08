/**
 * Words for "Your MP" (/mp and /mp/<constituency>), shared by the pages,
 * their structured data and llms.txt, so all three always say the same.
 */

export const MP_TITLE = "Your MP";
export const MP_DESCRIPTION =
  "Find your MP by postcode, constituency or name: who they are, the promises we track for them and their party, and how they voted in the Commons recently. Your postcode is never stored.";

export const mpPageTitle = (constituency: string) => `Your MP in ${constituency}: promises and votes`;
export const mpPageDescription = (constituency: string, mp: string | null) =>
  mp
    ? `${mp} is the MP for ${constituency}. See the promises we track for them and their party, and how they voted in the Commons recently, from UK Parliament's open data.`
    : `The seat of ${constituency} is vacant until a by-election. See who held it last, from UK Parliament's open data.`;

export const LOOKUP_STEPS = [
  "Type your postcode, or the name of your constituency or MP.",
  "We find your constituency and take you to its page. Your postcode is used once and then forgotten.",
  "The page shows your MP, the promises we track for them and their party, and how they voted recently.",
];

/** Privacy in one line, under the search box. */
export const LOOKUP_PRIVACY = "We use your postcode once to find your constituency, then forget it. It is never stored, logged or put in a web address.";

export const MP_FAQ: { q: string; a: string }[] = [
  {
    q: "How do you find my MP from my postcode?",
    a: "Our server asks postcodes.io, which uses the Office for National Statistics' postcode directory, which constituency your postcode is in. We then send you to that constituency's page. We do not store or log your postcode, and it never appears in a web address, so the page you land on says nothing about you.",
  },
  {
    q: "Where does the information about MPs come from?",
    a: "From UK Parliament's open data: the Members API for who holds each seat, their party and when they became an MP, and the Commons Votes API for how they voted. We check it once a day. Each vote links to its official record.",
  },
  {
    q: "Why does the page show my MP's party's promises?",
    a: "Most promises are made by parties and their leaders, not by individual MPs. So the page shows any promises we track in the MP's own name, then a short summary of their party's, with a link to all of them. Every party is held to the same standard.",
  },
  {
    q: "What do \"voted for\" and \"voted against\" mean?",
    a: "In a division, MPs vote Aye or No on one question, such as whether a bill should go ahead or whether to add a new clause. \"For\" means Aye and \"against\" means No. Where we can, the page puts the question in plain words.",
  },
  {
    q: "Why are some votes missing?",
    a: "The page lists the most recent votes an MP cast. MPs miss votes for many reasons, such as illness, government or constituency business, or an agreement with an MP from another party that both stay away. The Speaker and Deputy Speakers do not vote, and Sinn Féin MPs do not take their seats.",
  },
];

/** Required attributions (Open Parliament Licence; OGL and the ONS Postcode Directory's terms for postcodes.io). */
export const OPL_ATTRIBUTION = "Contains Parliamentary information licensed under the Open Parliament Licence v3.0.";
export const OPL_URL = "https://www.parliament.uk/site-information/copyright-parliament/open-parliament-licence/";
export const ONSPD_ATTRIBUTION =
  "Postcode lookup by postcodes.io, using the ONS Postcode Directory. Source: Office for National Statistics licensed under the Open Government Licence v3.0. Contains OS data © Crown copyright and database right. Contains Royal Mail data © Royal Mail copyright and database right.";
export const OGL_URL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
