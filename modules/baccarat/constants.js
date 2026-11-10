const COMMANDS = ["百家樂", "百家樂AI", "baccarat", "🎲 百家樂AI"];
const RESULTS = ["閒", "和", "莊"];
const MODES = ["AI配注", "天門", "自由配注"];
const PLATFORMS = ["DG", "MT", "歐博"];

const DG_ROOMS = [
  "RB01",
  "RB02",
  "RB03",
  "RB04",
  "RB05",
  "RB06",
  "RB07",
  "S01",
  "S02",
  "S03",
  "S05",
  "S06",
  "S07",
];

const MT_ROOMS = [
  "B01-L", "B02-L", "B03-L",
  "B01", "B02", "B03", "B03A",
  "B05", "B06", "B07", "B08", "B09", "B10",
];

const AB_ROOMS = [
  "B501", "B502", "B503", "B504", "B505", "B506", "B507",
  "B601", "B602", "B603", "B604", "B605", "B618",
  "B801", "B802", "B803", "B819", "B820",
  "Q501", "Q502", "Q601", "Q701", "Q702", "Q801", "Q802", "Q803", "Q804",
  "C501", "C701", "C801", "C802", "IB801", "IB802",
  "V971", "V972", "V981", "V982",
];

module.exports = {
  COMMANDS,
  RESULTS,
  MODES,
  PLATFORMS,
  DG_ROOMS,
  MT_ROOMS,
  AB_ROOMS,
};
