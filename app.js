const STORAGE_KEY = "flight-career-manager-v1";
const BACKUP_KEY = "flight-career-manager-backups-v1";
const SAVE_ENVELOPE_FORMAT = "flight-career-save-aes-gcm-v1";
// The key is deliberately stable so an encrypted export can be imported after an update
// or on another installation of the application. AES-GCM still authenticates every byte.
const SAVE_ENCRYPTION_SECRET = "模飞生涯|flight-career-manager|save-key|v1";
const SAVE_ENCRYPTION_ALGORITHM = { name: "AES-GCM", length: 256 };
const SAVE_IV_LENGTH = 12;
const AVATAR_PRESETS = Array.from({ length: 9 }, (_, index) => {
  const id = `preset-${String(index + 1).padStart(2, "0")}`;
  return { id, label: `预设 ${String(index + 1).padStart(2, "0")}`, src: `./assets/avatars/${id}.png` };
});
let saveCryptoKeyPromise = null;
let saveWriteChain = Promise.resolve();
let backupWriteChain = Promise.resolve();
let backupCache = [];
let saveStorageError = null;
let saveStorageHydrated = false;
let backupsHydrated = false;

async function readStorageValue(key) {
  const desktopStorage = window.desktopApp?.readPersistentStorage;
  if (typeof desktopStorage === "function") {
    try {
      const persistentValue = await desktopStorage(key);
      if (typeof persistentValue === "string" && persistentValue) return persistentValue;
    } catch {
      // Fall back to this origin's legacy browser storage if the desktop file is unavailable.
    }
  }
  const legacyValue = localStorage.getItem(key);
  if (legacyValue && typeof window.desktopApp?.writePersistentStorage === "function") {
    try {
      await window.desktopApp.writePersistentStorage(key, legacyValue);
    } catch {
      // The legacy value remains usable for this launch even if migration cannot be written.
    }
  }
  return legacyValue;
}

async function writeStorageValue(key, value) {
  let browserStorageError = null;
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    browserStorageError = error;
  }
  if (typeof window.desktopApp?.writePersistentStorage === "function") {
    await window.desktopApp.writePersistentStorage(key, value);
    return;
  }
  if (browserStorageError) throw browserStorageError;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function saveCryptoKey() {
  if (saveCryptoKeyPromise) return saveCryptoKeyPromise;
  saveCryptoKeyPromise = (async () => {
    const webCrypto = globalThis.crypto;
    if (!webCrypto?.subtle || !globalThis.TextEncoder) throw new Error("save-crypto-unavailable");
    const digest = await webCrypto.subtle.digest("SHA-256", new TextEncoder().encode(SAVE_ENCRYPTION_SECRET));
    return webCrypto.subtle.importKey("raw", digest, SAVE_ENCRYPTION_ALGORITHM, false, ["encrypt", "decrypt"]);
  })();
  return saveCryptoKeyPromise;
}

async function encryptSaveText(text) {
  const webCrypto = globalThis.crypto;
  const key = await saveCryptoKey();
  const iv = webCrypto.getRandomValues(new Uint8Array(SAVE_IV_LENGTH));
  const ciphertext = await webCrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({
    format: SAVE_ENVELOPE_FORMAT,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext))
  });
}

async function decryptSaveText(raw) {
  const envelope = JSON.parse(String(raw || ""));
  if (envelope?.format !== SAVE_ENVELOPE_FORMAT || envelope.algorithm !== "AES-GCM") throw new Error("save-format-invalid");
  const webCrypto = globalThis.crypto;
  const key = await saveCryptoKey();
  const plaintext = await webCrypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
    key,
    base64ToBytes(envelope.data)
  );
  return new TextDecoder().decode(plaintext);
}

async function decodeSavePayload(raw) {
  const text = String(raw || "");
  const parsed = JSON.parse(text);
  if (parsed?.format !== SAVE_ENVELOPE_FORMAT) return { value: parsed, legacy: true };
  return { value: JSON.parse(await decryptSaveText(text)), legacy: false };
}

const rankRules = [
  { rank: "学员", minHours: 0, nextHours: 20, label: "距离副驾" },
  { rank: "副驾", minHours: 20, nextHours: 120, label: "距离机长" },
  { rank: "机长", minHours: 120, nextHours: 320, label: "距离教员" },
  { rank: "教员", minHours: 320, nextHours: 500, label: "距离高级教员" },
  { rank: "高级教员", minHours: 500, nextHours: 800, label: "距离检查员" },
  { rank: "检查员", minHours: 800, nextHours: 1200, label: "距离资深检查员" },
  { rank: "资深检查员", minHours: 1200, nextHours: 2000, label: "距离航司导师" },
  { rank: "航司导师", minHours: 2000, nextHours: null, label: "已达顶级" }
];

const LOGO_BASE_URL = "./assets/logos/";
const FUEL_PRICE_PER_KG = 1.35;
const STARTER_HELICOPTER_ID = "cabri-g2";
const companyPilotNames = [
  "林浩", "周岚", "陈默", "赵航", "王宁", "叶晨", "韩雪", "许安", "高远", "沈飞",
  "Alex Carter", "Emma Wilson", "Liam Chen", "Olivia Zhang", "Noah Smith", "Mia Taylor", "Ethan Lee", "Sophia Brown", "Lucas Wang", "Ava Miller"
];
const companyPilotFallbackNames = ["候选飞行员A", "候选飞行员B", "候选飞行员C", "候选飞行员D", "候选飞行员E", "候选飞行员F"];
const companyPilotKinds = [
  "训练机", "特技机", "水陆两栖", "超轻型", "通航单发", "通航双发", "野外短距",
  "单发涡桨", "双发涡桨", "通用涡桨", "轻型喷气", "公务喷气", "干线喷气", "货运喷气",
  "支线客机", "宽体客机", "超大型客机", "超大货运", "军用运输", "重型运输", "高速喷气",
  "直升机", "重型直升机", "旋翼机", "复古飞机", "复古训练"
];
const COMPANY_TASK_OFFER_COUNT = 12;
const COMPANY_STARTUP_FUNDS_MIN = 10_000;
const COMPANY_STARTUP_FUNDS_MAX = 100_000;
const companyTaskCategories = ["客运", "货运", "包机", "医疗", "搜救", "观光"];

const airlines = [
  { id: "aal", code: "AAL", name: "美国航空", region: "北美", salary: 500, rep: 0, type: "综合航司", color: "info" },
  { id: "dal", code: "DAL", name: "达美航空", region: "北美", salary: 510, rep: 0, type: "综合航司", color: "info" },
  { id: "ual", code: "UAL", name: "美国联合航空", region: "北美", salary: 515, rep: 5, type: "综合航司", color: "info" },
  { id: "baw", code: "BAW", name: "英国航空", region: "欧洲", salary: 540, rep: 15, type: "国际航司", color: "good" },
  { id: "afr", code: "AFR", name: "法国航空", region: "欧洲", salary: 535, rep: 15, type: "国际航司", color: "good" },
  { id: "dlh", code: "DLH", name: "汉莎航空", region: "欧洲", salary: 545, rep: 20, type: "国际航司", color: "good" },
  { id: "klm", code: "KLM", name: "荷兰皇家航空", region: "欧洲", salary: 525, rep: 15, type: "国际航司", color: "good" },
  { id: "uae", code: "UAE", name: "阿联酋航空", region: "中东", salary: 690, rep: 55, type: "远程航司", color: "warn" },
  { id: "qtr", code: "QTR", name: "卡塔尔航空", region: "中东", salary: 675, rep: 50, type: "远程航司", color: "warn" },
  { id: "sia", code: "SIA", name: "新加坡航空", region: "东南亚", salary: 660, rep: 45, type: "远程航司", color: "warn" },
  { id: "cpa", code: "CPA", name: "国泰航空", region: "港澳台", salary: 610, rep: 35, type: "国际航司", color: "good" },
  { id: "ana", code: "ANA", name: "全日空", region: "东北亚", salary: 570, rep: 25, type: "综合航司", color: "info" },
  { id: "jal", code: "JAL", name: "日本航空", region: "东北亚", salary: 565, rep: 25, type: "综合航司", color: "info" },
  { id: "cca", code: "CCA", name: "中国国际航空", region: "中国大陆", salary: 560, rep: 25, type: "综合航司", color: "info" },
  { id: "ces", code: "CES", name: "中国东方航空", region: "中国大陆", salary: 545, rep: 20, type: "综合航司", color: "info" },
  { id: "csn", code: "CSN", name: "中国南方航空", region: "中国大陆", salary: 550, rep: 20, type: "综合航司", color: "info" },
  { id: "fdx", code: "FDX", name: "联邦快递航空", region: "全球货运", salary: 620, rep: 30, type: "货运航司", color: "bad" },
  { id: "gti", code: "GTI", name: "阿特拉斯航空", region: "全球货运", salary: 650, rep: 40, type: "货运航司", color: "bad" },
  { id: "qfa", code: "QFA", name: "澳洲航空", region: "大洋洲", salary: 615, rep: 35, type: "国际航司", color: "good" },
  { id: "thy", code: "THY", name: "土耳其航空", region: "欧亚枢纽", salary: 590, rep: 30, type: "国际航司", color: "good" },
  { id: "cxa", code: "CXA", name: "厦门航空", region: "中国大陆", salary: 490, rep: 10, type: "综合航司", color: "info" },
  { id: "chh", code: "CHH", name: "海南航空", region: "中国大陆", salary: 520, rep: 15, type: "综合航司", color: "info" },
  { id: "csc", code: "CSC", name: "山东航空", region: "中国大陆", salary: 455, rep: 5, type: "支线航司", color: "info" },
  { id: "cqh", code: "CQH", name: "春秋航空", region: "中国大陆", salary: 420, rep: 0, type: "低成本航司", color: "info" },
  { id: "dkh", code: "DKH", name: "东海航空", region: "中国大陆", salary: 430, rep: 0, type: "低成本航司", color: "info" },
  { id: "cal", code: "CAL", name: "中华航空", region: "港澳台", salary: 535, rep: 20, type: "国际航司", color: "good" },
  { id: "eva", code: "EVA", name: "长荣航空", region: "港澳台", salary: 540, rep: 20, type: "国际航司", color: "good" },
  { id: "aar", code: "AAR", name: "韩亚航空", region: "东北亚", salary: 520, rep: 18, type: "国际航司", color: "good" },
  { id: "kal", code: "KAL", name: "大韩航空", region: "东北亚", salary: 535, rep: 20, type: "国际航司", color: "good" },
  { id: "mas", code: "MAS", name: "马来西亚航空", region: "东南亚", salary: 495, rep: 12, type: "国际航司", color: "info" },
  { id: "tha", code: "THA", name: "泰国国际航空", region: "东南亚", salary: 500, rep: 12, type: "国际航司", color: "info" },
  { id: "gia", code: "GIA", name: "印度尼西亚鹰航", region: "东南亚", salary: 480, rep: 10, type: "国际航司", color: "info" },
  { id: "vjc", code: "VJC", name: "越捷航空", region: "东南亚", salary: 415, rep: 0, type: "低成本航司", color: "info" },
  { id: "pal", code: "PAL", name: "菲律宾航空", region: "东南亚", salary: 470, rep: 8, type: "国际航司", color: "info" },
  { id: "anz", code: "ANZ", name: "新西兰航空", region: "大洋洲", salary: 560, rep: 25, type: "国际航司", color: "good" },
  { id: "swa", code: "SWA", name: "西南航空", region: "北美", salary: 455, rep: 0, type: "低成本航司", color: "info" },
  { id: "asa", code: "ASA", name: "阿拉斯加航空", region: "北美", salary: 475, rep: 5, type: "区域航司", color: "info" },
  { id: "jbu", code: "JBU", name: "捷蓝航空", region: "北美", salary: 450, rep: 0, type: "低成本航司", color: "info" },
  { id: "swr", code: "SWR", name: "瑞士国际航空", region: "欧洲", salary: 530, rep: 15, type: "国际航司", color: "good" },
  { id: "ibe", code: "IBE", name: "伊比利亚航空", region: "欧洲", salary: 500, rep: 12, type: "国际航司", color: "info" },
  { id: "tap", code: "TAP", name: "葡萄牙航空", region: "欧洲", salary: 490, rep: 10, type: "国际航司", color: "info" },
  { id: "sas", code: "SAS", name: "北欧航空", region: "欧洲", salary: 500, rep: 12, type: "国际航司", color: "info" },
  { id: "fin", code: "FIN", name: "芬兰航空", region: "欧洲", salary: 510, rep: 15, type: "国际航司", color: "good" },
  { id: "etd", code: "ETD", name: "阿提哈德航空", region: "中东", salary: 645, rep: 45, type: "远程航司", color: "warn" },
  { id: "gfa", code: "GFA", name: "海湾航空", region: "中东", salary: 540, rep: 20, type: "国际航司", color: "good" },
  { id: "eth", code: "ETH", name: "埃塞俄比亚航空", region: "非洲", salary: 555, rep: 22, type: "国际航司", color: "good" },
  { id: "saa", code: "SAA", name: "南非航空", region: "非洲", salary: 515, rep: 15, type: "国际航司", color: "info" },
  { id: "amx", code: "AMX", name: "墨西哥航空", region: "拉丁美洲", salary: 500, rep: 12, type: "国际航司", color: "info" }
];

const airportDatabase = [
  ["ZBAA", 40.0801, 116.5846, "北京首都"], ["ZBAD", 39.5098, 116.4105, "北京大兴"],
  ["ZBSJ", 38.2807, 114.6973, "石家庄"], ["ZBTJ", 39.1244, 117.3462, "天津"],
  ["ZSPD", 31.1443, 121.8083, "上海浦东"], ["ZSSS", 31.1979, 121.3363, "上海虹桥"],
  ["ZSNJ", 31.742, 118.862, "南京"], ["ZSHC", 30.2295, 120.4344, "杭州"],
  ["ZGGG", 23.3924, 113.2988, "广州"], ["ZGSZ", 22.6393, 113.8107, "深圳"],
  ["VHHH", 22.308, 113.9185, "香港"], ["VMMC", 22.1496, 113.5915, "澳门"],
  ["ZUUU", 30.5785, 103.9471, "成都双流"], ["ZUTF", 30.319, 104.445, "成都天府"],
  ["ZUCK", 29.7192, 106.6417, "重庆"], ["ZPPP", 25.1019, 102.9292, "昆明"],
  ["ZLXY", 34.4471, 108.7516, "西安"], ["ZHHH", 30.7838, 114.2081, "武汉"],
  ["ZHCC", 34.5197, 113.8409, "郑州"], ["ZSQD", 36.3619, 120.0883, "青岛"],
  ["RJTT", 35.5494, 139.7798, "东京羽田"], ["RJAA", 35.772, 140.3929, "东京成田"],
  ["RJBB", 34.4347, 135.244, "大阪关西"], ["RJCC", 42.7752, 141.6923, "札幌"],
  ["RKSI", 37.4602, 126.4407, "首尔仁川"], ["WSSS", 1.3644, 103.9915, "新加坡"],
  ["VTBS", 13.69, 100.7501, "曼谷"], ["RPLL", 14.5086, 121.0198, "马尼拉"],
  ["EGLL", 51.47, -0.4543, "伦敦希思罗"], ["EGKK", 51.1537, -0.1821, "伦敦盖特威克"],
  ["LFPG", 49.0097, 2.5479, "巴黎戴高乐"], ["EDDF", 50.0379, 8.5622, "法兰克福"],
  ["EHAM", 52.3105, 4.7683, "阿姆斯特丹"], ["EBBR", 50.901, 4.4844, "布鲁塞尔"],
  ["LEMD", 40.4983, -3.5676, "马德里"], ["LIRF", 41.8003, 12.2389, "罗马"],
  ["KLAX", 33.9416, -118.4085, "洛杉矶"], ["KLAS", 36.084, -115.1537, "拉斯维加斯"],
  ["KSFO", 37.6213, -122.379, "旧金山"], ["KSEA", 47.4502, -122.3088, "西雅图"],
  ["KDEN", 39.8561, -104.6737, "丹佛"], ["KASE", 39.2232, -106.8688, "阿斯彭"],
  ["KDFW", 32.8998, -97.0403, "达拉斯"], ["KORD", 41.9742, -87.9073, "芝加哥"],
  ["KJFK", 40.6413, -73.7781, "纽约肯尼迪"], ["KBOS", 42.3656, -71.0096, "波士顿"],
  ["PHNL", 21.3187, -157.9224, "檀香山"], ["PHOG", 20.8986, -156.4305, "茂宜岛"],
  ["YSSY", -33.9399, 151.1753, "悉尼"], ["YMML", -37.6733, 144.8433, "墨尔本"]
].map(([icao, lat, lon, name]) => ({ icao, lat, lon, name }));

let globalAirportDatabase = [...airportDatabase];
let globalAirportIndex = new Map(globalAirportDatabase.map((airport) => [airport.icao, airport]));

const aircraftCatalog = [
  { id: "c152", name: "Cessna 152", kind: "训练机", price: 0, rent: 0, range: 415, pace: "初训", unlockHours: 0, note: "MSFS 经典初级训练机，适合起落航线和基础飞行。" },
  { id: "c152-aerobat", name: "Cessna 152 Aerobat", kind: "训练机", price: 115000, rent: 650, range: 415, pace: "初级特技", unlockHours: 4, note: "强化结构的特技训练型 C152，适合基础特技和精确操纵训练。" },
  { id: "c172", name: "Cessna 172 Skyhawk", kind: "训练机", price: 0, rent: 0, range: 640, pace: "轻型", unlockHours: 0, note: "稳定、节省成本，适合练级和短途通勤。" },
  { id: "c172-classic", name: "Cessna 172 Classic", kind: "训练机", price: 78000, rent: 450, range: 640, pace: "仪表训练", unlockHours: 2, note: "传统仪表版，适合低成本 IFR 训练。" },
  { id: "cap10", name: "Robin CAP 10", kind: "特技机", price: 98000, rent: 680, range: 380, pace: "特技", unlockHours: 4, note: "适合短程训练、特技飞行和挑战任务。" },
  { id: "pitts", name: "Pitts Special S2S", kind: "特技机", price: 140000, rent: 900, range: 298, pace: "特技", unlockHours: 8, note: "高机动特技机，用于高级操纵训练。" },
  { id: "extra330", name: "Extra 330LT", kind: "特技机", price: 230000, rent: 1200, range: 650, pace: "特技", unlockHours: 12, note: "更强的特技性能，适合表演与挑战航段。" },
  { id: "icon-a5", name: "ICON A5", kind: "水陆两栖", price: 245000, rent: 1400, range: 427, pace: "休闲", unlockHours: 6, note: "水陆两栖轻型机，适合湖区和海岸线任务。" },
  { id: "vl3", name: "JMB VL-3", kind: "超轻型", price: 170000, rent: 950, range: 690, pace: "快速轻航", unlockHours: 5, note: "速度快、成本低，适合轻型通勤。" },
  { id: "ctsl", name: "Flight Design CTSL", kind: "超轻型", price: 150000, rent: 850, range: 850, pace: "轻航", unlockHours: 5, note: "适合低成本 VFR 长距离练习。" },
  { id: "dr400", name: "Robin DR400/100 Cadet", kind: "通航单发", price: 165000, rent: 850, range: 550, pace: "通航", unlockHours: 6, note: "欧洲通航训练机，适合短途与手动日志。" },
  { id: "da40-ng", name: "Diamond DA40 NG", kind: "通航单发", price: 430000, rent: 2200, range: 940, pace: "现代训练", unlockHours: 10, note: "玻璃座舱单发，适合仪表训练和区域飞行。" },
  { id: "dv20", name: "Diamond DV20", kind: "训练机", price: 210000, rent: 1200, range: 630, pace: "训练", unlockHours: 8, note: "轻型训练平台，适合初级职业阶段。" },
  { id: "bonanza-g36", name: "Beechcraft Bonanza G36", kind: "通航单发", price: 780000, rent: 3200, range: 920, pace: "私人飞行", unlockHours: 14, note: "适合包机、商务短途和私人航段。" },
  { id: "baron-g58", name: "Beechcraft Baron G58", kind: "通航双发", price: 1350000, rent: 4600, range: 1480, pace: "双发训练", unlockHours: 22, note: "进入双发运行的自然过渡机型。" },
  { id: "da62", name: "Diamond DA62", kind: "通航双发", price: 1420000, rent: 4800, range: 1280, pace: "高效双发", unlockHours: 24, note: "高效双发通航机，适合商务包机和中短程任务。" },
  { id: "xcub", name: "CubCrafters XCub", kind: "野外短距", price: 320000, rent: 1800, range: 695, pace: "STOL", unlockHours: 10, note: "野外短距起降任务的轻型平台。" },
  { id: "nxcub", name: "CubCrafters NX Cub", kind: "野外短距", price: 350000, rent: 1900, range: 800, pace: "STOL", unlockHours: 12, note: "更现代的短距起降机，适合偏远机场。" },
  { id: "zlin-savage", name: "Zlin Savage Cub", kind: "野外短距", price: 190000, rent: 1100, range: 377, pace: "STOL", unlockHours: 8, note: "轻型野外飞行和低速操纵训练。" },
  { id: "cessna-208", name: "Cessna 208B Grand Caravan EX", kind: "单发涡桨", price: 2600000, rent: 7200, range: 1070, pace: "支线/货运", unlockHours: 35, note: "支线客货两用，适合生涯模式早期商业任务。" },
  { id: "kingair-350", name: "Beechcraft King Air 350i", kind: "双发涡桨", price: 6200000, rent: 11800, range: 1806, pace: "商务涡桨", unlockHours: 48, note: "经典双发涡桨，覆盖商务、医疗和支线任务。" },
  { id: "pc6", name: "Pilatus PC-6 Porter", kind: "通用涡桨", price: 1800000, rent: 5200, range: 730, pace: "山地/短距", unlockHours: 28, note: "短距起降能力强，适合山区和特殊任务。" },
  { id: "pc12", name: "Pilatus PC-12 NGX", kind: "通用涡桨", price: 1280000, rent: 4600, range: 1800, pace: "多用途", unlockHours: 24, note: "适合货运、包机和支线运行。" },
  { id: "tbm", name: "Daher TBM 930", kind: "单发涡桨", price: 420000, rent: 3200, range: 1730, pace: "快速通勤", unlockHours: 12, note: "适合短中程通勤与轻货运。" },
  { id: "cirrus-sr22", name: "Cirrus SR22", kind: "通航单发", price: 720000, rent: 3100, range: 1200, pace: "私人飞行", unlockHours: 16, note: "现代私人飞机，适合高端包机和跨区通勤。" },
  { id: "sf50", name: "Cirrus Vision Jet SF50", kind: "轻型喷气", price: 2400000, rent: 7800, range: 1275, pace: "个人喷气", unlockHours: 42, note: "从通航迈向喷气任务的入门机型。" },
  { id: "cj4", name: "Cessna Citation CJ4", kind: "公务喷气", price: 7200000, rent: 13500, range: 2165, pace: "公务机", unlockHours: 60, note: "中短程公务喷气，适合高收益包机。" },
  { id: "longitude", name: "Cessna Citation Longitude", kind: "公务喷气", price: 15500000, rent: 24000, range: 3500, pace: "远程公务", unlockHours: 95, note: "远程公务机，适合高级包机和跨洲任务。" },
  { id: "atr42", name: "ATR 42-600", kind: "支线客机", price: 11800000, rent: 19500, range: 726, pace: "支线", unlockHours: 75, note: "短程支线航班和岛际航线的经济选择。" },
  { id: "atr72", name: "ATR 72-600", kind: "支线客机", price: 17800000, rent: 26000, range: 825, pace: "支线", unlockHours: 85, note: "更大载客量的支线涡桨客机。" },
  { id: "a310", name: "Airbus A310-300", kind: "宽体客机", price: 42000000, rent: 52000, range: 5150, pace: "宽体", unlockHours: 140, note: "经典宽体客机，适合长途客运和复古任务。" },
  { id: "a320", name: "Airbus A320neo", kind: "干线喷气", price: 8400000, rent: 15000, range: 3300, pace: "干线", unlockHours: 80, note: "需要成熟的航线经验，适合高频中短程。" },
  { id: "a321", name: "Airbus A321LR", kind: "干线喷气", price: 12800000, rent: 22000, range: 4000, pace: "长程窄体", unlockHours: 105, note: "长程窄体航线，用于中远程高收益任务。" },
  { id: "a330", name: "Airbus A330-200", kind: "宽体客机", price: 52000000, rent: 62000, range: 7250, pace: "远程宽体", unlockHours: 170, note: "远程国际航班和大型航司任务。" },
  { id: "a400m", name: "Airbus A400M Atlas", kind: "军用运输", price: 65000000, rent: 68000, range: 4700, pace: "重型运输", unlockHours: 180, note: "大型运输任务，适合特殊货运玩法。" },
  { id: "beluga", name: "Airbus Beluga XL", kind: "超大货运", price: 78000000, rent: 82000, range: 2300, pace: "特殊货运", unlockHours: 210, note: "超大件货运任务，高收益但机场受限。" },
  { id: "b38m", name: "Boeing 737 MAX 8", kind: "干线喷气", price: 9800000, rent: 17800, range: 3550, pace: "干线", unlockHours: 90, note: "现代窄体客机，适合主流航司运行。" },
  { id: "b738", name: "Boeing 737-800", kind: "干线喷气", price: 7900000, rent: 14200, range: 2930, pace: "干线", unlockHours: 70, note: "高频干线任务的主力机型，适合插件扩展。" },
  { id: "b738-bdsf", name: "737-800F", kind: "货运喷气", price: 8500000, rent: 15500, range: 2930, pace: "干线货运", unlockHours: 75, note: "Boeing 737-800BDSF 货机，适合中短程货运航线。" },
  { id: "b738-bcf", name: "737-800F", kind: "货运喷气", price: 8500000, rent: 15500, range: 2930, pace: "干线货运", unlockHours: 75, note: "Boeing 737-800BCF 货机，适合中短程货运航线。" },
  { id: "b748", name: "Boeing 747-8 Intercontinental", kind: "超大型客机", price: 88000000, rent: 92000, range: 8000, pace: "洲际", unlockHours: 220, note: "最高等级远程客运和旗舰航线。" },
  { id: "b787", name: "Boeing 787-10 Dreamliner", kind: "宽体客机", price: 76000000, rent: 85000, range: 6430, pace: "远程宽体", unlockHours: 200, note: "现代远程宽体客机，适合洲际航线。" },
  { id: "c17", name: "Boeing C-17 Globemaster III", kind: "重型运输", price: 95000000, rent: 99000, range: 4482, pace: "战略运输", unlockHours: 240, note: "重型运输职业线的终局机型。" },
  { id: "fa18", name: "F/A-18E Super Hornet", kind: "高速喷气", price: 58000000, rent: 62000, range: 1275, pace: "高速挑战", unlockHours: 160, note: "用于高速挑战和特殊飞行活动，不参与普通客运。" },
  { id: "h125", name: "Airbus H125", kind: "直升机", price: 3600000, rent: 9800, range: 340, pace: "直升机", unlockHours: 55, note: "适合观光、山区、救援和短距任务。" },
  { id: "h225", name: "Airbus H225", kind: "重型直升机", price: 24000000, rent: 38000, range: 452, pace: "搜救/运输", unlockHours: 120, note: "重型直升机，适合搜救、海上平台和运输任务。" },
  { id: "bell-407", name: "Bell Model 407", kind: "直升机", price: 3200000, rent: 8500, range: 324, pace: "观光/通勤", unlockHours: 35, note: "灵活的轻型涡轴直升机，适合观光、包机和近场救援。" },
  { id: "s64f", name: "Erickson S-64F Skycrane", kind: "重型直升机", price: 36000000, rent: 48000, range: 200, pace: "重型吊运", unlockHours: 145, note: "专用空中吊车，适合消防、工程吊运和特殊货运。" },
  { id: "ch47d", name: "Boeing CH-47D Chinook", kind: "重型直升机", price: 38000000, rent: 52000, range: 400, pace: "重型运输", unlockHours: 150, note: "双旋翼重型运输直升机，适合大型货运和救援投送。" },
  { id: "ec135-t1", name: "Eurocopter EC-135 T1", kind: "直升机", price: 6200000, rent: 14000, range: 342, pace: "医疗/公务", unlockHours: 60, note: "双发轻型直升机，适合医疗转运、公务和城市救援。" },
  { id: "r66", name: "Robinson R66 Turbine", kind: "直升机", price: 1200000, rent: 4800, range: 350, pace: "轻型通勤", unlockHours: 25, note: "经济型涡轴直升机，适合训练、观光和短途包机。" },
  { id: "cabri-g2", name: "Guimbal Cabri G2", kind: "直升机", price: 0, rent: 0, range: 380, pace: "直升机训练", unlockHours: 0, note: "初始配发的轻型活塞直升机，适合旋翼机训练和低成本观光。" },
  { id: "uh1h", name: "Bell UH-1H Huey", kind: "直升机", price: 3000000, rent: 9000, range: 275, pace: "通用运输", unlockHours: 45, note: "经典通用直升机，适合货物投送、搜救和特殊任务。" },
  // MSFS 2024 catalog models. Existing records above keep their legacy IDs
  // so saved fleets and accepted missions remain compatible.
  { id: "b736", name: "Boeing 737-600", kind: "干线喷气", price: 16000000, rent: 23000, range: 3000, pace: "干线", unlockHours: 95, note: "737 家族短机身型号，适合中短程干线运行。" },
  { id: "b739", name: "Boeing 737-900ER", kind: "干线喷气", price: 18000000, rent: 25000, range: 3300, pace: "干线", unlockHours: 105, note: "高容量窄体客机，适合繁忙干线航班。" },
  { id: "b752", name: "Boeing 757-200", kind: "干线喷气", price: 27000000, rent: 38000, range: 3900, pace: "中程干线", unlockHours: 120, note: "高性能中程客机，适合跨区域和高原航线。" },
  { id: "b762", name: "Boeing 767-200ER", kind: "宽体客机", price: 38000000, rent: 52000, range: 6800, pace: "宽体", unlockHours: 140, note: "经典双发宽体客机，适合中远程客运。" },
  { id: "b763", name: "Boeing 767-300ER", kind: "宽体客机", price: 45000000, rent: 60000, range: 7200, pace: "宽体", unlockHours: 155, note: "加长型 767，适合中远程客运和货运。" },
  { id: "b772", name: "Boeing 777-200ER", kind: "宽体客机", price: 75000000, rent: 88000, range: 9700, pace: "远程宽体", unlockHours: 210, note: "远程双发宽体客机，适合洲际航线。" },
  { id: "b77l", name: "Boeing 777-200LR", kind: "宽体客机", price: 82000000, rent: 95000, range: 12400, pace: "超远程", unlockHours: 240, note: "超远程 777，适合跨洲和极长航段。" },
  { id: "b77w", name: "Boeing 777-300ER", kind: "宽体客机", price: 88000000, rent: 98000, range: 9600, pace: "远程宽体", unlockHours: 220, note: "高载客量远程宽体，适合主干国际航线。" },
  { id: "b788", name: "Boeing 787-8 Dreamliner", kind: "宽体客机", price: 68000000, rent: 78000, range: 7355, pace: "远程宽体", unlockHours: 190, note: "高效远程宽体客机，适合跨洲和中远程任务。" },
  { id: "b789", name: "Boeing 787-9 Dreamliner", kind: "宽体客机", price: 72000000, rent: 82000, range: 7635, pace: "远程宽体", unlockHours: 205, note: "加长型 Dreamliner，兼顾航程和载客量。" },
  { id: "a220-100", name: "Airbus A220-100", kind: "干线喷气", price: 22000000, rent: 32000, range: 3450, pace: "支线干线", unlockHours: 100, note: "高效小型窄体客机，适合区域干线。" },
  { id: "a220-300", name: "Airbus A220-300", kind: "干线喷气", price: 25000000, rent: 36000, range: 3450, pace: "支线干线", unlockHours: 105, note: "A220 加长型，适合高频区域客运。" },
  { id: "a300-600", name: "Airbus A300-600", kind: "宽体客机", price: 35000000, rent: 48000, range: 7500, pace: "宽体", unlockHours: 145, note: "经典双发宽体，适合客运和货运航线。" },
  { id: "a319", name: "Airbus A319", kind: "干线喷气", price: 18000000, rent: 26000, range: 3700, pace: "干线", unlockHours: 100, note: "A320 家族短机身型号，适合中短程航线。" },
  { id: "a319neo", name: "Airbus A319neo", kind: "干线喷气", price: 20000000, rent: 29000, range: 3900, pace: "干线", unlockHours: 105, note: "新一代高效窄体客机，适合区域干线。" },
  { id: "a320-ceo", name: "Airbus A320", kind: "干线喷气", price: 22000000, rent: 31000, range: 3300, pace: "干线", unlockHours: 90, note: "经典 A320，适合高频中短程航线。" },
  { id: "a321-ceo", name: "Airbus A321", kind: "干线喷气", price: 25000000, rent: 35000, range: 4000, pace: "长程窄体", unlockHours: 105, note: "高容量窄体客机，适合繁忙中程航线。" },
  { id: "a330-300", name: "Airbus A330-300", kind: "宽体客机", price: 58000000, rent: 68000, range: 6100, pace: "远程宽体", unlockHours: 180, note: "高载客量宽体客机，适合国际航线。" },
  { id: "a340-300", name: "Airbus A340-300", kind: "宽体客机", price: 62000000, rent: 74000, range: 13700, pace: "远程宽体", unlockHours: 210, note: "四发远程宽体，适合经典洲际航线。" },
  { id: "a350-900", name: "Airbus A350-900", kind: "宽体客机", price: 90000000, rent: 100000, range: 15000, pace: "超远程", unlockHours: 260, note: "新一代远程宽体客机，适合高等级洲际任务。" },
  { id: "a350-1000", name: "Airbus A350-1000", kind: "宽体客机", price: 105000000, rent: 115000, range: 16100, pace: "超远程", unlockHours: 280, note: "A350 加长型，适合高载客量远程航线。" },
  { id: "a380-800", name: "Airbus A380-800", kind: "宽体客机", price: 130000000, rent: 145000, range: 15200, pace: "超大型", unlockHours: 320, note: "超大型远程客机，适合旗舰洲际航线。" },
  { id: "crj-200", name: "Bombardier CRJ-200", kind: "支线客机", price: 7000000, rent: 10000, range: 1500, pace: "支线", unlockHours: 55, note: "小型支线喷气机，适合短程区域航线。" },
  { id: "crj-700", name: "Bombardier CRJ-700", kind: "支线客机", price: 10000000, rent: 14000, range: 1800, pace: "支线", unlockHours: 60, note: "中型支线客机，适合区域通勤航班。" },
  { id: "crj-900", name: "Bombardier CRJ-900", kind: "支线客机", price: 14000000, rent: 18000, range: 1800, pace: "支线", unlockHours: 65, note: "加长型支线客机，适合高频区域航线。" },
  { id: "crj-1000", name: "Bombardier CRJ-1000", kind: "支线客机", price: 18000000, rent: 23000, range: 2800, pace: "支线", unlockHours: 75, note: "CRJ 家族最大型号，适合中程支线。" },
  { id: "e170", name: "Embraer E170", kind: "支线客机", price: 12000000, rent: 18000, range: 2150, pace: "支线", unlockHours: 70, note: "灵活的小型支线喷气机，适合区域通勤。" },
  { id: "e175", name: "Embraer E175", kind: "支线客机", price: 16000000, rent: 22000, range: 4000, pace: "支线", unlockHours: 75, note: "成熟的支线客机，适合高频短中程航线。" },
  { id: "e190", name: "Embraer E190", kind: "支线客机", price: 22000000, rent: 30000, range: 4500, pace: "支线干线", unlockHours: 85, note: "大容量支线客机，适合区域干线运行。" },
  { id: "e195", name: "Embraer E195", kind: "支线客机", price: 25000000, rent: 34000, range: 4800, pace: "支线干线", unlockHours: 90, note: "E-Jet 加长型，适合中程高频客运。" },
  { id: "e190-e2", name: "Embraer E190-E2", kind: "支线客机", price: 28000000, rent: 38000, range: 5200, pace: "新一代支线", unlockHours: 100, note: "新一代高效支线客机，适合中程航线。" },
  { id: "e195-e2", name: "Embraer E195-E2", kind: "支线客机", price: 32000000, rent: 43000, range: 5500, pace: "新一代支线", unlockHours: 110, note: "E2 家族大容量型号，适合区域干线。" },
  { id: "md-11", name: "McDonnell Douglas MD-11", kind: "宽体客机", price: 60000000, rent: 78000, range: 7300, pace: "远程宽体", unlockHours: 190, note: "经典三发宽体，适合远程客运和货运。" },
  { id: "md-82", name: "McDonnell Douglas MD-82", kind: "干线喷气", price: 10000000, rent: 16000, range: 2050, pace: "中程干线", unlockHours: 65, note: "经典中程窄体客机，适合复古航线任务。" },
  { id: "bae-146-100", name: "BAe 146-100", kind: "支线客机", price: 8000000, rent: 12000, range: 1500, pace: "支线", unlockHours: 55, note: "短距起降支线客机，适合区域机场。" },
  { id: "bae-146-200", name: "BAe 146-200", kind: "支线客机", price: 10000000, rent: 14000, range: 1800, pace: "支线", unlockHours: 60, note: "加长型 146，适合短中程支线运行。" },
  { id: "bae-146-300", name: "BAe 146-300", kind: "支线客机", price: 12000000, rent: 17000, range: 1900, pace: "支线", unlockHours: 65, note: "146 家族大容量型号，适合区域客运。" },
  { id: "avro-rj85", name: "Avro RJ85", kind: "支线客机", price: 11000000, rent: 16000, range: 1650, pace: "支线", unlockHours: 60, note: "安静的四发支线客机，适合短程区域航线。" },
  { id: "fokker-f28", name: "Fokker F28 Fellowship", kind: "支线客机", price: 8000000, rent: 12000, range: 1700, pace: "复古支线", unlockHours: 55, note: "经典早期支线喷气机，适合复古航线任务。" },
  { id: "pitts-s1s", name: "Aviat Pitts Special S-1S", kind: "特技机", price: 120000, rent: 800, range: 290, pace: "单座特技", unlockHours: 6, note: "灵敏的单座特技机，适合高级操纵和表演飞行。" },
  { id: "kingair-c90", name: "Beechcraft King Air C90 GTX", kind: "双发涡桨", price: 3800000, rent: 8500, range: 1260, pace: "商务涡桨", unlockHours: 40, note: "紧凑型双发商务涡桨，适合客运、包机和医疗任务。" },
  { id: "blackbird-310r", name: "Blackbird Simulations 310R", kind: "通航双发", price: 850000, rent: 3000, range: 900, pace: "经典双发", unlockHours: 18, note: "经典轻型双发飞机，适合区域包机和仪表飞行。" },
  { id: "cessna-185", name: "Cessna 185 Skywagon", kind: "野外短距", price: 480000, rent: 2300, range: 620, pace: "野外通航", unlockHours: 14, note: "高性能尾轮通航机，适合偏远机场和野外运输。" },
  { id: "cessna-188", name: "Cessna 188 AGtruck", kind: "通航单发", price: 320000, rent: 1800, range: 430, pace: "农业作业", unlockHours: 12, note: "专用农业作业飞机，也可承担低空巡查和短途任务。" },
  { id: "cessna-404", name: "Cessna 404 Titan", kind: "通航双发", price: 1900000, rent: 5600, range: 1700, pace: "客货运输", unlockHours: 32, note: "双发客货运输机，适合区域物流和多人包机。" },
  { id: "cessna-c400", name: "Cessna C400 Corvalis TT", kind: "通航单发", price: 820000, rent: 3400, range: 1250, pace: "高性能通航", unlockHours: 20, note: "高速增压单发飞机，适合商务通勤和长距离包机。" },
  { id: "cessna-c408", name: "Cessna C408 SkyCourier", kind: "双发涡桨", price: 8200000, rent: 14500, range: 920, pace: "支线/货运", unlockHours: 58, note: "现代双发支线涡桨，适合客运和高频货运任务。" },
  { id: "curtiss-jn4", name: "Curtiss JN-4 Jenny", kind: "复古飞机", price: 180000, rent: 1200, range: 155, pace: "复古训练", unlockHours: 8, note: "早期双翼训练机，适合历史飞行和低速观光。" },
  { id: "dhc6-300", name: "De Havilland DHC-6-300 Twin Otter", kind: "双发涡桨", price: 6800000, rent: 12500, range: 775, pace: "短距支线", unlockHours: 52, note: "可靠的双发短距运输机，适合岛际、货运和偏远机场。" },
  { id: "magni-m24", name: "Magni Gyro M24", kind: "旋翼机", price: 180000, rent: 1100, range: 430, pace: "自转旋翼", unlockHours: 10, note: "轻型封闭式旋翼机，适合低空观光和巡查任务。" },
  { id: "draco-x", name: "Atey Aviation Draco X", kind: "野外短距", price: 1500000, rent: 5200, range: 620, pace: "极限 STOL", unlockHours: 30, note: "高性能涡桨短距飞机，适合山地和极端野外起降。" },
  { id: "pc24", name: "Pilatus PC-24", kind: "公务喷气", price: 11500000, rent: 21000, range: 2000, pace: "多用途公务", unlockHours: 82, note: "可在短跑道运行的公务喷气机，适合高级包机和商务航段。" },
  { id: "ryan-nyp", name: "Ryan NYP Spirit of St. Louis", kind: "复古飞机", price: 650000, rent: 2800, range: 3590, pace: "历史远航", unlockHours: 25, note: "经典远航飞机，适合历史挑战和复古长途任务。" },
  { id: "saab-340", name: "Saab 340", kind: "支线客机", price: 9000000, rent: 15000, range: 935, pace: "支线涡桨", unlockHours: 62, note: "成熟的双发支线客机，适合区域客运和短程航线。" }
];

// Type ratings are kept per catalog model so similarly named variants still
// require their own affordable check-out license.
const aircraftLicenseCatalog = aircraftCatalog.map((aircraft) => ({
  id: aircraft.id,
  name: aircraft.name,
  kind: aircraft.kind,
  cost: Math.min(12000, 1200 + Math.round((Number(aircraft.unlockHours) || 0) * 35 / 100) * 100)
}));

const aircraftIdentityRules = {
  c152: ["C152", "CESSNA152", "152ASOBO"],
  "c152-aerobat": ["CESSNA152AEROBAT", "C152AEROBAT", "152AEROBAT", "AEROBAT"],
  c172: ["C172", "C172SP", "CESSNA172", "SKYHAWK"],
  "c172-classic": ["C172", "C172SP", "CESSNA172", "SKYHAWK"],
  cap10: ["CAP10", "ROBINCAPI0"],
  pitts: ["AVIATPITTSSPECIALS2S", "PITTSS2S", "S2S"],
  extra330: ["EXTRA330", "EXTRA330LT", "EA30"],
  "icon-a5": ["ICONA5", "ICA5"],
  vl3: ["JMBVL3", "VL3"],
  ctsl: ["FLIGHTDESIGNCTSL", "CTSL", "CTSW"],
  dr400: ["ROBINDR400", "DR400", "DR40"],
  "da40-ng": ["DIAMONDDA40", "DA40NG", "DA40"],
  dv20: ["DIAMONDDV20", "DV20"],
  "bonanza-g36": ["BONANZAG36", "BEECHCRAFTBONANZAG36", "BEECHCRAFTG36", "G36ASOBO", "BE36"],
  "baron-g58": ["BARONG58", "BEECHCRAFTBARONG58", "BEECHCRAFTG58", "G58ASOBO", "BE58"],
  da62: ["DIAMONDDA62", "DA62"],
  xcub: ["CUBCRAFTERSXCUB", "XCUB", "CC19"],
  nxcub: ["CUBCRAFTERSNXCUB", "NXCUB"],
  "zlin-savage": ["ZLINSAVAGECUB", "SAVAGECUB"],
  "cessna-208": ["CESSNA208B", "CESSNA208BGRANDCARAVANEX", "208BGRANDCARAVANEX", "C208B", "GRANDCARAVAN", "CARAVANEX"],
  "kingair-350": ["BEECHCRAFTKINGAIR350I", "KINGAIR350I", "KINGAIR350", "350IASOBO", "B350"],
  pc6: ["PILATUSPC6", "PC6PORTER", "PC6T"],
  pc12: ["PILATUSPC12", "PC12NGX", "PC12"],
  tbm: ["DAHERTBM930", "TBM930", "TBM9"],
  "cirrus-sr22": ["CIRRUSSR22", "SR22"],
  sf50: ["VISIONJETSF50", "CIRRUSSF50", "CIRRUSVISIONJETG2", "VISIONJETG2", "SF50"],
  cj4: ["CITATIONCJ4", "CESSNACJ4", "C25C"],
  longitude: ["CITATIONLONGITUDE", "CESSNALONGITUDE", "C700"],
  atr42: ["ATR42600", "AT46"],
  atr72: ["ATR72600", "AT76"],
  a310: ["AIRBUSA310", "INIBUILDSA310", "A310"],
  a320: ["AIRBUSA320NEO", "A320NEO", "FLYBYWIREA32NX", "A32NX", "A20N"],
  a321: ["AIRBUSA321LR", "A321LR", "A321NEO", "A21N"],
  a330: ["AIRBUSA330200", "A330200", "A332"],
  a400m: ["AIRBUSA400M", "A400MATLAS", "A400"],
  beluga: ["AIRBUSBELUGAXL", "BELUGAXL", "A337", "BLCF"],
  b38m: ["BOEING737MAX8", "B737MAX8", "737MAX8", "B38M"],
  b738: ["BOEING737800", "B737800", "PMDG737800", "IFLY737800", "737800", "B738"],
  "b738-bdsf": ["BOEING737800BDSF", "B737800BDSF", "PMDG737800BDSF", "737800BDSF", "B738BDSF"],
  "b738-bcf": ["BOEING737800BCF", "B737800BCF", "PMDG737800BCF", "737800BCF", "B738BCF"],
  b748: ["BOEING7478", "BOEING7478I", "7478INTERCONTINENTAL", "B748"],
  b787: ["BOEING78710", "78710DREAMLINER", "ASOBO78710", "B78X"],
  c17: ["BOEINGC17", "C17GLOBEMASTER", "GLOBEMASTERIII"],
  fa18: ["FA18E", "F18E", "F18H", "SUPERHORNET"],
  h125: ["AIRBUSH125", "H125", "AS50"],
  h225: ["AIRBUSH225", "H225", "EC25"],
  "bell-407": ["BELLModel407", "BELL407", "INIBUILDSBELL407", "ASOBOBELL407", "B407"],
  s64f: ["ERICKSONS64F", "S64FSKYCRANE", "S64F", "SKYCRANE"],
  ch47d: ["BOEINGCH47D", "CH47DCHINOOK", "CH47D", "CHINOOK"],
  "ec135-t1": ["EUROCOPTEREC135T1", "EC135T1", "EC135", "EC35"],
  r66: ["ROBINSONR66TURBINE", "ROBINSONR66", "CARENADOR66", "R66"],
  "cabri-g2": ["GUIMBALCABRIG2", "CABRIG2", "ASOBOCABRIG2"],
  uh1h: ["BELLUH1H", "UH1HHUEY", "TAOGUH1H", "UH1H", "HUEY"],
  b736: ["BOEING737600", "B737600", "737600", "B736"],
  b739: ["BOEING737900ER", "B737900ER", "737900ER", "B739"],
  b752: ["BOEING757200", "B757200", "757200", "B752"],
  b762: ["BOEING767200ER", "B767200ER", "767200ER", "B762"],
  b763: ["BOEING767300ER", "B767300ER", "767300ER", "B763"],
  b772: ["BOEING777200ER", "B777200ER", "777200ER", "B772"],
  b77l: ["BOEING777200LR", "B777200LR", "777200LR", "B77L"],
  b77w: ["BOEING777300ER", "B777300ER", "777300ER", "B77W"],
  b788: ["BOEING7878", "7878DREAMLINER", "7878", "B788"],
  b789: ["BOEING7879", "7879DREAMLINER", "7879", "B789"],
  "a220-100": ["AIRBUSA220100", "A220100", "BCS1"],
  "a220-300": ["AIRBUSA220300", "A220300", "BCS3"],
  "a300-600": ["AIRBUSA300600", "A300600", "A306"],
  a319: ["AIRBUSA319", "FENIXA319", "A319"],
  a319neo: ["AIRBUSA319NEO", "A319NEO", "A19N"],
  "a320-ceo": ["AIRBUSA320", "FENIXA320", "A320CEO", "A320"],
  "a321-ceo": ["AIRBUSA321", "FENIXA321", "A321CEO", "A321"],
  "a330-300": ["AIRBUSA330300", "A330300", "A333"],
  "a340-300": ["AIRBUSA340300", "A340300", "A343"],
  "a350-900": ["AIRBUSA350900", "A350900ULR", "A350900", "A359"],
  "a350-1000": ["AIRBUSA3501000", "A3501000ETIHADCABIN", "A3501000", "A35K"],
  "a380-800": ["FLYBYWIREA380X", "AIRBUSA380X", "A380842", "AIRBUSA380800", "A380800", "A388"],
  "crj-200": ["BOMBARDIERCRJ200", "CRJ200", "CRJ2"],
  "crj-700": ["BOMBARDIERCRJ700", "CRJ700", "CRJ7"],
  "crj-900": ["BOMBARDIERCRJ900", "CRJ900", "CRJ9"],
  "crj-1000": ["BOMBARDIERCRJ1000", "CRJ1000", "CRJX"],
  e170: ["EMBRAERE170", "E170"],
  e175: ["EMBRAERE175", "E175", "E75L"],
  e190: ["EMBRAERE190", "E190"],
  e195: ["EMBRAERE195", "E195"],
  "e190-e2": ["EMBRAERE190E2", "E190E2", "E290"],
  "e195-e2": ["EMBRAERE195E2", "E195E2", "E295"],
  "md-11": ["MCDONNELLDouglasMD11", "MCDONNELDOUGLASMD11", "MD11"],
  "md-82": ["MCDONNELLDouglasMD82", "MCDONNELDOUGLASMD82", "MD82"],
  "bae-146-100": ["BAE146100", "BAE146", "146100", "B461"],
  "bae-146-200": ["BAE146200", "146200", "B462"],
  "bae-146-300": ["BAE146300", "146300", "B463"],
  "avro-rj85": ["AVRORJ85", "RJ85"],
  "fokker-f28": ["FOKKERF28", "F28FELLOWSHIP", "F28"],
  "pitts-s1s": ["AVIATPITTSSPECIALS1S", "PITTSS1S", "S1S"],
  "kingair-c90": ["BEECHCRAFTKINGAIRC90GTX", "KINGAIRC90GTX", "KINGAIRC90", "C90GTX", "BE9L"],
  "blackbird-310r": ["BLACKBIRDSIMULATIONS310R", "CESSNA310R", "BLACKBIRD310R", "C310R", "C310"],
  "cessna-185": ["CESSNA185SKYWAGON", "CESSNA185", "C185SKYWAGON", "C185"],
  "cessna-188": ["CESSNA188AGTRUCK", "CESSNA188", "AGTRUCK", "C188"],
  "cessna-404": ["CESSNA404TITAN", "CESSNA404", "C404TITAN", "C404"],
  "cessna-c400": ["CESSNAC400CORVALISTT", "C400CORVALISTT", "CORVALISTT", "C400"],
  "cessna-c408": ["CESSNAC408SKYCOURIER", "C408SKYCOURIER", "SKYCOURIER", "C408"],
  "curtiss-jn4": ["CURTISSJN4JENNY", "CURTISSJN4", "JN4JENNY", "JN4"],
  "dhc6-300": ["DEHAVILLANDDHC6300", "DHC6300", "TWINOTTER300", "DHC6"],
  "magni-m24": ["MAGNIGYROM24", "MAGNIM24", "GYROM24", "M24ORION"],
  "draco-x": ["ATEYAVIATIONDRACOX", "GOTFRIENDSDRACOX", "DRACOX"],
  pc24: ["PILATUSPC24", "PC24", "PC24JET"],
  "ryan-nyp": ["RYANNYPSPIRITOFSTLOUIS", "RYANNYP", "SPIRITOFSTLOUIS", "NYP"],
  "saab-340": ["SAAB340", "SAAB340B", "SF34"]
};

// The catalog's `kind` is an operational subtype (for example, wide-body or
// turboprop) and is intentionally kept for mission/license rules.  The UI
// needs a stable manufacturer grouping instead, so derive it from the catalog
// identity/name without changing saved-fleet records.
function aircraftManufacturerFamily(aircraft) {
  const id = String(aircraft?.catalogId || aircraft?.id || "").trim().toLowerCase();
  const text = `${aircraft?.manufacturer || ""} ${aircraft?.name || ""} ${aircraft?.title || ""} ${aircraft?.aircraftTitle || ""}`.toUpperCase();
  if (text.includes("AIRBUS") || /^(a|beluga)/.test(id)) return "空客";
  if (text.includes("BOEING") || /^(b\d|b738-|ch47d$)/.test(id)) return "波音";
  return "其他制造商";
}

const passengerMissionKinds = new Set([
  "训练机", "通航单发", "通航双发", "单发涡桨", "双发涡桨", "支线客机",
  "支线干线", "干线喷气", "长程窄体", "宽体客机", "超大型客机",
  "公务喷气", "轻型喷气", "远程公务", "直升机", "重型直升机"
]);

// These multi-purpose models do not share a passenger-specific `kind`, but
// their real-world configuration supports passenger service.
const passengerMissionAircraftIds = new Set([
  "pc12", "cessna-c408", "dhc6-300", "saab-340", "kingair-c90", "pc6",
  "h125", "h225", "bell-407", "ec135-t1", "r66", "cabri-g2", "uh1h", "ch47d"
]);

function hasMissionCapability(category, aircraft) {
  if (!aircraft) return false;
  const id = String(aircraft.catalogId || aircraft.id || "").trim().toLowerCase();
  const kind = String(aircraft.kind || "");
  if (category === "客运") {
    // Cargo-only and combat/specialized transports must never enter the
    // passenger pool, even when their manufacturer is Airbus or Boeing.
    if (["货运喷气", "超大货运", "军用运输", "重型运输", "高速喷气"].includes(kind)) return false;
    return passengerMissionKinds.has(kind) || passengerMissionAircraftIds.has(id);
  }
  return false;
}

const missionPolicies = {
  客运: { min: 70, max: 1800, phases: ["日间", "傍晚"], kinds: ["训练机", "通航单发", "通航双发", "单发涡桨", "双发涡桨", "支线客机", "支线干线", "干线喷气", "长程窄体", "宽体客机", "超大型客机", "公务喷气", "轻型喷气", "远程公务", "直升机", "重型直升机"], label: "客运" },
  货运: { min: 45, max: 2200, phases: ["傍晚", "夜间"], kinds: ["通航单发", "单发涡桨", "通用涡桨", "双发涡桨", "支线客机", "干线喷气", "货运喷气", "重型运输", "超大货运", "直升机", "重型直升机"], label: "货运" },
  包机: { min: 35, max: 1200, phases: ["日间", "傍晚"], kinds: ["训练机", "通航单发", "通航双发", "单发涡桨", "双发涡桨", "公务喷气", "轻型喷气", "远程公务", "直升机", "旋翼机", "复古飞机"], label: "包机" },
  医疗: { min: 30, max: 550, phases: ["全天候"], kinds: ["通航单发", "单发涡桨", "通用涡桨", "双发涡桨", "直升机", "重型直升机"], label: "医疗转运" },
  搜救: { min: 8, max: 55, phases: ["日间", "傍晚"], kinds: ["野外短距", "通用涡桨", "直升机", "重型直升机", "水陆两栖"], label: "近场搜救" },
  海上救援: { min: 15, max: 75, phases: ["日间", "傍晚"], kinds: ["水陆两栖", "直升机", "重型直升机"], label: "近海救援" },
  事故调查: { min: 8, max: 60, phases: ["日间"], kinds: ["训练机", "通航单发", "野外短距", "通用涡桨", "直升机", "重型直升机", "旋翼机", "复古飞机"], label: "现场调查" }
};

const missionPools = {
  客运: ["区域通勤", "国内短途", "干线往返", "夜航客运"],
  货运: ["轻货转运", "区域物流", "夜间快件", "高价值货物"],
  包机: ["商务包机", "观光包机", "VIP接送", "临时调机"],
  医疗: ["紧急转运", "器官转运", "医疗包机", "山区救援"],
  搜救: ["坠机现场搜救", "事故现场支援", "失联飞机定位", "山地伤员撤离"],
  海上救援: ["海上人员搜救", "落水人员救援", "沉船现场救援", "遇险船只定位"],
  事故调查: ["航空事故调查", "道路事故支援", "残骸定位", "现场勘察"]
};

const emergencyMissionCategories = ["医疗", "搜救", "海上救援", "事故调查"];
const MISSION_OFFER_TARGET_COUNT = 50;
const MISSION_EMERGENCY_TARGET_COUNT = 2;
const MISSION_OFFER_LIFETIME_MS = 3 * 60_000;
const MISSION_REFRESH_INTERVAL_MS = 45_000;

const flightCareerMissionScenes = {
  坠机现场搜救: { icon: "siren", objectTitle: "FCMscene1", terrain: "land", requiresLanding: false, arrivalMode: "low-altitude", smokeTitle: "FCMsmoke1", clip: "FCMscene1nla1a", seconds: 2.5, radiusNm: 4, objective: "抵达事故现场，低空盘旋并确认幸存者位置" },
  事故现场支援: { icon: "ambulance", objectTitle: "FCMscene2", terrain: "land", requiresLanding: true, arrivalMode: "landing", smokeTitle: "FCMsmoke1", clip: "FCMscene2nla1a", seconds: 2.5, radiusNm: 3, objective: "运送救援人员并在现场附近安全着陆" },
  失联飞机定位: { icon: "scan-search", objectTitle: "FCMwreckedplane1", terrain: "land", requiresLanding: false, arrivalMode: "low-altitude", clip: "静态场景", seconds: 0, radiusNm: 6, objective: "沿搜索航线定位失联飞机残骸" },
  山地伤员撤离: { icon: "heart-pulse", objectTitle: "FCMscene2", terrain: "land", requiresLanding: true, arrivalMode: "landing", smokeTitle: "FCMsmoke1", clip: "FCMscene2nla1a", seconds: 2.5, radiusNm: 3, objective: "在复杂地形安全降落，完成伤员接载后再次起飞撤离" },
  海上人员搜救: { icon: "life-buoy", objectTitle: "FCMsea1", terrain: "water", requiresLanding: false, arrivalMode: "low-altitude", smokeTitle: "FCMsmoke1", clip: "FCMsea1nla1a / 1b / 1c", seconds: 40, radiusNm: 5, objective: "搜索海面人员，保持目视并完成救援" },
  落水人员救援: { icon: "waves", objectTitle: "FCMsea2", terrain: "water", requiresLanding: false, arrivalMode: "low-altitude", smokeTitle: "FCMsmoke1", clip: "FCMsea2nla1a", seconds: 4.17, radiusNm: 3, objective: "定位落水人员并在低速稳定状态下施救" },
  沉船现场救援: { icon: "ship-wheel", objectTitle: "FCMsinkingboat2", terrain: "water", requiresLanding: false, arrivalMode: "low-altitude", smokeTitle: "FCMsmoke1", clip: "FCMsinkingboat2nla1a", seconds: 6.67, radiusNm: 5, objective: "抵达沉船位置，确认遇险人员并呼叫支援" },
  遇险船只定位: { icon: "radar", objectTitle: "FCMsinkingboat4", terrain: "water", requiresLanding: false, arrivalMode: "low-altitude", smokeTitle: "FCMsmoke1", clip: "FCMsinkingboat4nla1a", seconds: 8.33, radiusNm: 7, objective: "根据最后坐标搜索并识别遇险船只" },
  航空事故调查: { icon: "search", objectTitle: "FCMcrashedplane6", terrain: "land", requiresLanding: true, arrivalMode: "landing", clip: "静态场景", seconds: 0, radiusNm: 3, objective: "运输调查组，在事故现场附近安全着陆并完成勘察" },
  道路事故支援: { icon: "car", objectTitle: "FCMcrashedcar2", terrain: "land", requiresLanding: false, arrivalMode: "low-altitude", clip: "静态场景", seconds: 0, radiusNm: 2, objective: "定位道路事故现场并引导地面救援" },
  残骸定位: { icon: "locate-fixed", objectTitle: "FCMwreckedplane4", terrain: "land", requiresLanding: false, arrivalMode: "low-altitude", clip: "静态场景", seconds: 0, radiusNm: 5, objective: "搜索指定区域并记录残骸位置" },
  现场勘察: { icon: "search-check", objectTitle: "FCMscene1", terrain: "land", requiresLanding: false, arrivalMode: "low-altitude", clip: "FCMscene1nla1a", seconds: 2.5, radiusNm: 3, objective: "完成现场航拍、位置标记和调查组投送" }
};

const missionSceneModelPolicies = {
  FCMscene1: { terrain: "land", requiresLanding: false },
  FCMscene2: { terrain: "land", requiresLanding: true },
  FCMwreckedplane1: { terrain: "land", requiresLanding: false },
  FCMsea1: { terrain: "water", requiresLanding: false },
  FCMsea2: { terrain: "water", requiresLanding: false },
  FCMsinkingboat2: { terrain: "water", requiresLanding: false },
  FCMsinkingboat4: { terrain: "water", requiresLanding: false },
  FCMcrashedplane6: { terrain: "land", requiresLanding: true },
  FCMcrashedcar2: { terrain: "land", requiresLanding: false },
  FCMwreckedplane4: { terrain: "land", requiresLanding: false }
};

const standardMissionScenes = {
  客运: { icon: "plane", label: "定期航线", objective: "按计划完成旅客运输和安全落地" },
  货运: { icon: "package", label: "货运航线", objective: "按任务要求完成货物运输" },
  包机: { icon: "briefcase-business", label: "包机航线", objective: "完成客户指定的包机航段" },
  医疗: { icon: "heart-pulse", label: "医疗转运", objective: "平稳完成医疗人员或物资转运" }
};

const missionArrivalRules = {
  landing: { radiusNm: 0.5, dwellSeconds: 15, speedLimitKt: 5 },
  "low-altitude": { radiusNm: 1, dwellSeconds: 0, speedLimitKt: 140 }
};

const achievementDefs = [
  { id: "first-flight", title: "首飞", desc: "完成第一段飞行。", test: (s) => s.stats.completedMissions >= 1 },
  { id: "ten-hours", title: "十小时", desc: "累计飞行 10 小时。", test: (s) => s.stats.totalHours >= 10 },
  { id: "twenty-hours", title: "基础资历", desc: "累计飞行 20 小时，完成副驾阶段。", test: (s) => s.stats.totalHours >= 20 },
  { id: "fifty-hours", title: "五十小时", desc: "累计飞行 50 小时。", test: (s) => s.stats.totalHours >= 50 },
  { id: "hundred-landings", title: "百次起降", desc: "完成 100 次起降。", test: (s) => s.stats.totalLandings >= 100 },
  { id: "five-hundred-landings", title: "起降专家", desc: "完成 500 次起降。", test: (s) => s.stats.totalLandings >= 500 },
  { id: "fleet-owner", title: "机队拥有者", desc: "购买或租用 3 架飞机。", test: (s) => s.fleet.some((a) => a.owned || a.rented) && s.fleet.filter((a) => a.owned || a.rented).length >= 3 },
  { id: "fleet-master", title: "大型机队", desc: "拥有或租用 10 架飞机。", test: (s) => s.fleet.filter((a) => a.owned || a.rented).length >= 10 },
  { id: "captain", title: "机长", desc: "晋升到机长。", test: (s) => getRankInfo(s.stats.totalHours).minHours >= 120 },
  { id: "senior-instructor", title: "高级教员", desc: "累计飞行达到 500 小时。", test: (s) => s.stats.totalHours >= 500 },
  { id: "flight-veteran", title: "资深飞行员", desc: "累计飞行达到 1,000 小时。", test: (s) => s.stats.totalHours >= 1000 },
  { id: "long-distance", title: "远程航线", desc: "累计飞行 100,000 海里。", test: (s) => s.stats.totalMiles >= 100000 },
  { id: "mission-veteran", title: "任务老兵", desc: "完成 50 个航班任务。", test: (s) => s.stats.completedMissions >= 50 },
  { id: "mission-commander", title: "任务指挥官", desc: "完成 250 个航班任务。", test: (s) => s.stats.completedMissions >= 250 },
  { id: "fuel-manager", title: "燃油管理师", desc: "累计消耗 10,000 千克燃油。", test: (s) => s.stats.totalFuelKg >= 10000 },
  { id: "fuel-budget", title: "燃油预算专家", desc: "累计燃油支出达到 10,000。", test: (s) => s.stats.totalFuelCost >= 10000 },
  { id: "logbook-keeper", title: "飞行记录员", desc: "完成 10 条飞行日志记录。", test: (s) => s.stats.manualLogs >= 10 || s.logs.length >= 10 },
  { id: "medical-response", title: "医疗响应", desc: "完成一次医疗或紧急任务。", test: (s) => s.missions.some((m) => m.status === "completed" && (m.category === "医疗" || m.priority === "emergency")) },
  { id: "type-rated", title: "机型签派员", desc: "取得 5 个机型考核执照。", test: (s) => (s.licenses || []).filter((license) => license.purchased && license.assessmentCompleted).length >= 5 },
  { id: "company-founder", title: "航空公司创始人", desc: "创建一家航空公司。", test: (s) => s.company?.created === true },
  { id: "company-fleet", title: "公司机队", desc: "为公司配备 3 架飞机。", test: (s) => (s.company?.aircraftIds || []).length >= 3 },
  { id: "company-crew", title: "机组团队", desc: "公司拥有 5 名在岗飞行员。", test: (s) => (s.company?.pilots || []).filter((pilot) => pilot.status === "active").length >= 5 }
];

var state = defaultState();

const els = {
  appShell: document.getElementById("appShell"),
  loginGate: document.getElementById("loginGate"),
  supportBtn: document.getElementById("supportBtn"),
  supportModal: document.getElementById("supportModal"),
  themeModeBtn: document.getElementById("themeModeBtn"),
  contactAuthorBtn: document.getElementById("contactAuthorBtn"),
  contactModal: document.getElementById("contactModal"),
  authorQqGroup: document.getElementById("authorQqGroup"),
  copyAuthorQqBtn: document.getElementById("copyAuthorQqBtn"),
  thankSupportBtn: document.getElementById("thankSupportBtn"),
  aboutBtn: document.getElementById("aboutBtn"),
  aboutModal: document.getElementById("aboutModal"),
  viewButtons: [...document.querySelectorAll("[data-view]")],
  views: {
    dashboard: document.getElementById("dashboardView"),
    missions: document.getElementById("missionsView"),
    map: document.getElementById("mapView"),
    monitor: document.getElementById("monitorView"),
    sop: document.getElementById("sopView"),
    schedules: document.getElementById("schedulesView"),
    logs: document.getElementById("logsView"),
    achievements: document.getElementById("achievementsView"),
    profile: document.getElementById("profileView"),
    hangar: document.getElementById("hangarView"),
    "aircraft-management": document.getElementById("aircraftManagementView"),
    company: document.getElementById("companyView")
  },
  pilotInitials: document.getElementById("pilotInitials"),
  pilotAvatarPreview: document.getElementById("pilotAvatarPreview"),
  avatarChoiceGrid: document.getElementById("avatarChoiceGrid"),
  avatarChoiceStatus: document.getElementById("avatarChoiceStatus"),
  pilotAvatarFile: document.getElementById("pilotAvatarFile"),
  uploadAvatarBtn: document.getElementById("uploadAvatarBtn"),
  pilotName: document.getElementById("pilotName"),
  loginPilotBtn: document.getElementById("loginPilotBtn"),
  pilotRank: document.getElementById("pilotRank"),
  nextRankLabel: document.getElementById("nextRankLabel"),
  rankProgressText: document.getElementById("rankProgressText"),
  rankMeter: document.getElementById("rankMeter"),
  totalHours: document.getElementById("totalHours"),
  reputation: document.getElementById("reputation"),
  balance: document.getElementById("balance"),
  totalMiles: document.getElementById("totalMiles"),
  milesTrend: document.getElementById("milesTrend"),
  totalLandings: document.getElementById("totalLandings"),
  topAircraft: document.getElementById("topAircraft"),
  topAircraftHours: document.getElementById("topAircraftHours"),
  completedCount: document.getElementById("completedCount"),
  activeMissionCount: document.getElementById("activeMissionCount"),
  careerGoal: document.getElementById("careerGoal"),
  careerGoalText: document.getElementById("careerGoalText"),
  dashboardSettlement: document.getElementById("dashboardSettlement"),
  airlinePanelTitle: document.getElementById("airlinePanelTitle"),
  airlinePanel: document.getElementById("airlinePanel"),
  airlineMeta: document.getElementById("airlineMeta"),
  recommendedMissions: document.getElementById("recommendedMissions"),
  missionsList: document.getElementById("missionsList"),
  missionSearch: document.getElementById("missionSearch"),
  missionDistanceSort: document.getElementById("missionDistanceSort"),
  missionStatusFilter: document.getElementById("missionStatusFilter"),
  missionCategoryButtons: [...document.querySelectorAll("[data-mission-category]")],
  refreshMissionsBtn: document.getElementById("refreshMissionsBtn"),
  missionResultCount: document.getElementById("missionResultCount"),
  careerMap: document.getElementById("careerMap"),
  mapPageTitle: document.getElementById("mapPageTitle"),
  mapPageSummary: document.getElementById("mapPageSummary"),
  mapPageCount: document.getElementById("mapPageCount"),
  mapTaskList: document.getElementById("mapTaskList"),
  mapLayerControls: [...document.querySelectorAll("[data-map-layer]")],
  followAircraftBtn: document.getElementById("followAircraftBtn"),
  toggleCompanyAircraftBtn: document.getElementById("toggleCompanyAircraftBtn"),
  scheduleSummary: document.getElementById("scheduleSummary"),
  scheduleList: document.getElementById("scheduleList"),
  planOriginInput: document.getElementById("planOriginInput"),
  planOriginResult: document.getElementById("planOriginResult"),
  planDestinationInput: document.getElementById("planDestinationInput"),
  planDestinationResult: document.getElementById("planDestinationResult"),
  planAircraftSelect: document.getElementById("planAircraftSelect"),
  planAircraftHint: document.getElementById("planAircraftHint"),
  generatePlannedMissionBtn: document.getElementById("generatePlannedMissionBtn"),
  backupList: document.getElementById("backupList"),
  confirmModal: document.getElementById("confirmModal"),
  confirmMessage: document.getElementById("confirmMessage"),
  recentLogs: document.getElementById("recentLogs"),
  logsList: document.getElementById("logsList"),
  sidebarLogs: document.getElementById("sidebarLogs"),
  simulatorStatus: document.getElementById("simulatorStatus"),
  simulatorAircraft: document.getElementById("simulatorAircraft"),
  simulatorPosition: document.getElementById("simulatorPosition"),
  simulatorFuel: document.getElementById("simulatorFuel"),
  simulatorMissionState: document.getElementById("simulatorMissionState"),
  hangarGrid: document.getElementById("hangarGrid"),
  hangarFilter: document.getElementById("hangarFilter"),
  hangarSearch: document.getElementById("hangarSearch"),
  aircraftManagementSummary: document.getElementById("aircraftManagementSummary"),
  aircraftManagementGrid: document.getElementById("aircraftManagementGrid"),
  aircraftManagementFilter: document.getElementById("aircraftManagementFilter"),
  aircraftManagementSearch: document.getElementById("aircraftManagementSearch"),
  companyIdentity: document.getElementById("companyIdentity"),
  companyManagementPanel: document.getElementById("companyManagementPanel"),
  companyTaskList: document.getElementById("companyTaskList"),
  companyPilotSummary: document.getElementById("companyPilotSummary"),
  companyPilotList: document.getElementById("companyPilotList"),
  companyApplicantList: document.getElementById("companyApplicantList"),
  companyHangarSummary: document.getElementById("companyHangarSummary"),
  companyHangarGrid: document.getElementById("companyHangarGrid"),
  companyHangarFilter: document.getElementById("companyHangarFilter"),
  companyHangarSearch: document.getElementById("companyHangarSearch"),
  companyFinanceSummary: document.getElementById("companyFinanceSummary"),
  companyTransactionList: document.getElementById("companyTransactionList"),
  companyFlightLogList: document.getElementById("companyFlightLogList"),
  achievementList: document.getElementById("achievementList"),
  profileOverview: document.getElementById("profileOverview"),
  fundSummary: document.getElementById("fundSummary"),
  fundTransactionList: document.getElementById("fundTransactionList"),
  profileRankTimeline: document.getElementById("profileRankTimeline"),
  aircraftLicenseList: document.getElementById("aircraftLicenseList"),
  licenseProgress: document.getElementById("licenseProgress"),
  refreshLicenseAssessmentsBtn: document.getElementById("refreshLicenseAssessmentsBtn"),
  toast: document.getElementById("toast"),
  pilotForm: document.getElementById("pilotForm"),
  pilotSubmitBtn: document.getElementById("pilotSubmitBtn"),
  pilotNameInput: document.getElementById("pilotNameInput"),
  pilotBaseInput: document.getElementById("pilotBaseInput"),
  logModal: document.getElementById("logModal"),
  logForm: document.getElementById("logForm"),
  logModalTitle: document.getElementById("logModalTitle"),
  logFrom: document.getElementById("logFrom"),
  logTo: document.getElementById("logTo"),
  logAircraft: document.getElementById("logAircraft"),
  logHours: document.getElementById("logHours"),
  logMiles: document.getElementById("logMiles"),
  logIncome: document.getElementById("logIncome"),
  logNotes: document.getElementById("logNotes"),
  importFile: document.getElementById("importFile"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  settingsForm: document.getElementById("settingsForm"),
  speechVolumeRange: document.getElementById("speechVolumeRange"),
  speechVolumeValue: document.getElementById("speechVolumeValue"),
  freeModeToggle: document.getElementById("freeModeToggle"),
  sopModeToggle: document.getElementById("sopModeToggle"),
  sopMonitor: document.getElementById("sopMonitor"),
  sopMonitorScore: document.getElementById("sopMonitorScore"),
  sopMonitorSummary: document.getElementById("sopMonitorSummary"),
  sopMonitorTable: document.getElementById("sopMonitorTable"),
  sopModeStatus: document.getElementById("sopModeStatus"),
  sopMissionName: document.getElementById("sopMissionName"),
  sopCurrentStage: document.getElementById("sopCurrentStage"),
  sopCompletedCount: document.getElementById("sopCompletedCount"),
  sopDeductionTotal: document.getElementById("sopDeductionTotal"),
  sopTelemetryStatus: document.getElementById("sopTelemetryStatus"),
  sopStageTrack: document.getElementById("sopStageTrack"),
  sopDeductionList: document.getElementById("sopDeductionList"),
  monitorConnection: document.getElementById("monitorConnection"),
  monitorConnectionTitle: document.getElementById("monitorConnectionTitle"),
  monitorConnectionDetail: document.getElementById("monitorConnectionDetail"),
  monitorUpdatedAt: document.getElementById("monitorUpdatedAt"),
  runtimeLogStatus: document.getElementById("runtimeLogStatus"),
  runtimeLogList: document.getElementById("runtimeLogList"),
  refreshRuntimeLogBtn: document.getElementById("refreshRuntimeLogBtn"),
  clearRuntimeLogBtn: document.getElementById("clearRuntimeLogBtn"),
  exportRuntimeLogBtn: document.getElementById("exportRuntimeLogBtn")
};

let logMode = "manual";
let leafletLoadPromise = null;
let leafletMap = null;
let liveAircraftMarker = null;
let liveTrackLine = null;
const companyAircraftMarkers = new Map();
let liveTrackPoints = [];
let lastLiveTrackTimestamp = "";
let lastLiveHeadingDeg = 0;
let simulatorPollTimer = null;
let lastTelemetry = null;
let lastTelemetryConnected = false;
let lastSimulatorPayload = {};
let simulatorStartPromise = null;
let nextSimulatorAutoConnectAt = 0;
let simulatorAutoConnectFailures = 0;
let lastFleetTelemetryPersistAt = 0;
let lastAircraftManagementRenderAt = 0;
const fuelTargetPercents = new Map();
const fuelTargetBaselines = new Map();
const refuelPendingIds = new Set();
const missionMetarCache = new Map();
let missionMetarPromise = null;
const missionMetarClientTtlMs = 5 * 60 * 1000;
let sceneSyncPromise = null;
let speechQueue = [];
let speechPlaying = false;
let speechServiceErrorNotified = false;
let lastMonitorConnectionState = "";
let runtimeLogRequestPromise = null;
let lastRuntimeLogSignature = "";
let lastRuntimeLogAt = 0;
let settingsDraftSpeechVolume = 1;
let missionRefreshTimer = null;
const endingMissionIds = new Set();
const FREE_MODE_CASH = 1_000_000;
const preferredVoiceName = "zh-CN-XiaoxiaoNeural";
const taskLogEventKeys = new Set([
  "accepted",
  "engine-started",
  "origin-confirmed",
  "departure-mismatch",
  "takeoff",
  "target-confirmed",
  "returning",
  "simulator-disconnected",
  "sop-violation",
  "sop-stage",
  "completed"
]);

function defaultState() {
  return {
    pilot: { name: "Alex Chen", base: "ZBAA", avatarDataUrl: "", avatarPreset: "preset-01", loggedIn: false, hasCompletedLogin: false },
    airlineId: airlines[0].id,
    cash: 25000,
    reputation: 12,
    stats: {
      totalHours: 0,
      totalMiles: 0,
      totalLandings: 0,
      completedMissions: 0,
      manualLogs: 0,
      totalFuelKg: 0,
      totalFuelCost: 0
    },
    missions: seedMissions(),
    schedules: [],
    backups: [],
    hangarFilter: "all",
    hangarSearch: "",
    aircraftManagementFilter: "all",
    aircraftManagementSearch: "",
    companyHangarFilter: "all",
    companyHangarSearch: "",
    missionFilters: { search: "", status: "all", category: "all", distanceSort: "near" },
    settings: {
      speechVolume: 1,
      mapAutoTrack: false,
      mapShowCompanyAircraft: true,
      mapLayer: "standard",
      darkMode: false,
      freeMode: false,
      freeModeCashSnapshot: null,
      sopMode: false
    },
    company: {
      created: false,
      airlineId: airlines[0].id,
      base: "ZBAA",
      funds: 0,
      pilots: [],
      applicants: [],
      taskOffers: [],
      tasks: [],
      flightLogs: [],
      aircraftIds: [],
      starterAircraftGranted: false,
      transactions: [],
      activeSection: "management"
    },
    features: { sceneObjectsSeeded: false, starterHelicopterGranted: true, landingWearStartedAt: 0 },
    logs: [],
    taskEvents: [],
    fundTransactions: [openingFundTransaction(25000)],
    licenses: aircraftLicenseCatalog.map((license) => ({ id: license.id, purchased: false, purchasedAt: null, assessmentCompleted: false, assessmentCompletedAt: null })),
    simulatorFlight: emptySimulatorFlight(),
    fleet: aircraftCatalog.map((aircraft) => ({
      ...aircraft,
      catalogId: aircraft.id,
      owned: aircraft.id === "c172" || aircraft.id === STARTER_HELICOPTER_ID,
      rented: false,
      selected: aircraft.id === "c172",
      lastFuelKg: null,
      fuelCapacityKg: null,
      lastFuelAt: null,
      lastSeenTitle: "",
      conditionPercent: 100,
      lastMaintenanceAt: null,
      lastLandingReportAt: null,
      lastLandingRateFpm: null,
      lastLandingPeakG: null,
      lastLandingWearPercent: 0,
      lastLandingAirport: "",
      lastLandingRunway: ""
    })),
    achievements: achievementDefs.map((a) => ({ id: a.id, unlocked: false })),
    activeView: "dashboard"
  };
}

function loadState() {
  return defaultState();
}

async function hydrateStoredState() {
  const raw = await readStorageValue(STORAGE_KEY);
  if (!raw) {
    saveStorageHydrated = true;
    return;
  }
  try {
    const decoded = await decodeSavePayload(raw);
    state = mergeState(defaultState(), decoded.value);
    saveStorageHydrated = true;
    if (decoded.legacy) await saveState();
  } catch (error) {
    // Authentication failure means the stored data was edited or corrupted. Do not
    // overwrite it with a fresh default state; an explicit reset remains available.
    saveStorageError = error;
    saveStorageHydrated = true;
    state = defaultState();
  }
}

function normalizeFleetAircraft(template, found = {}) {
  return {
    ...template,
    ...found,
    catalogId: String(found.catalogId || template.catalogId || template.id || found.id || ""),
    lastFuelKg: found.lastFuelKg !== null && found.lastFuelKg !== undefined && Number.isFinite(Number(found.lastFuelKg))
      ? Math.max(0, Number(found.lastFuelKg))
      : null,
    fuelCapacityKg: found.fuelCapacityKg !== null && found.fuelCapacityKg !== undefined && Number.isFinite(Number(found.fuelCapacityKg))
      ? Math.max(0, Number(found.fuelCapacityKg))
      : null,
    lastFuelAt: Number.isFinite(Number(found.lastFuelAt)) ? Number(found.lastFuelAt) : null,
    lastSeenTitle: String(found.lastSeenTitle || ""),
    conditionPercent: Math.max(0, Math.min(100, Number(found.conditionPercent ?? 100) || 0)),
    lastMaintenanceAt: Number.isFinite(Number(found.lastMaintenanceAt)) ? Number(found.lastMaintenanceAt) : null,
    lastLandingReportAt: Number.isFinite(Number(found.lastLandingReportAt)) ? Number(found.lastLandingReportAt) : null,
    lastLandingRateFpm: Number.isFinite(Number(found.lastLandingRateFpm)) ? Math.abs(Math.round(Number(found.lastLandingRateFpm))) : null,
    lastLandingPeakG: Number.isFinite(Number(found.lastLandingPeakG)) ? Number(found.lastLandingPeakG) : null,
    lastLandingWearPercent: Math.max(0, Number(found.lastLandingWearPercent) || 0),
    lastLandingAirport: String(found.lastLandingAirport || ""),
    lastLandingRunway: String(found.lastLandingRunway || "")
  };
}

function mergeState(base, incoming) {
  const merged = structuredClone(base);
  if (!incoming || typeof incoming !== "object") return merged;
  merged.pilot = { ...merged.pilot, ...(incoming.pilot || {}) };
  merged.pilot.name = String(merged.pilot.name || base.pilot.name).trim() || base.pilot.name;
  merged.pilot.base = String(merged.pilot.base || base.pilot.base).trim().toUpperCase() || base.pilot.base;
  merged.pilot.avatarDataUrl = isAvatarDataUrl(merged.pilot.avatarDataUrl) ? merged.pilot.avatarDataUrl : "";
  merged.pilot.avatarPreset = AVATAR_PRESETS.some((avatar) => avatar.id === incoming.pilot?.avatarPreset)
    ? incoming.pilot.avatarPreset
    : merged.pilot.avatarDataUrl ? "" : base.pilot.avatarPreset;
  merged.pilot.loggedIn = incoming.pilot?.loggedIn === true;
  merged.pilot.hasCompletedLogin = incoming.pilot?.hasCompletedLogin === true;
  merged.airlineId = airlines.some((airline) => airline.id === incoming.airlineId) ? incoming.airlineId : merged.airlineId;
  merged.cash = Number.isFinite(incoming.cash) ? incoming.cash : merged.cash;
  merged.reputation = Number.isFinite(incoming.reputation) ? incoming.reputation : merged.reputation;
  merged.stats = { ...merged.stats, ...(incoming.stats || {}) };
  merged.stats.totalFuelKg = Math.max(0, Number(merged.stats.totalFuelKg) || 0);
  merged.stats.totalFuelCost = Math.max(0, Number(merged.stats.totalFuelCost) || 0);
  merged.missions = (Array.isArray(incoming.missions) ? incoming.missions : merged.missions)
    .filter((mission) => mission && typeof mission === "object")
    .map(normalizeMission);
  // Re-send an in-progress route after the route format changed from
  // base -> task -> base to the active first leg base -> task.
  merged.missions = merged.missions.map((mission) => {
    if (mission?.status !== "accepted" || !mission.verification) return mission;
    if (Number(mission.verification.flightPlanFormatVersion || 0) >= 2) return mission;
    return {
      ...mission,
      verification: {
        ...mission.verification,
        flightPlanFormatVersion: 2,
        flightPlanState: "waiting",
        flightPlanDetail: "航路格式已更新，等待 MSFS 连接后重新发送任务点"
      }
    };
  });
  merged.schedules = Array.isArray(incoming.schedules) ? incoming.schedules : merged.schedules;
  merged.backups = Array.isArray(incoming.backups) ? incoming.backups : merged.backups;
  merged.hangarFilter = typeof incoming.hangarFilter === "string" ? incoming.hangarFilter : merged.hangarFilter;
  merged.hangarSearch = typeof incoming.hangarSearch === "string" ? incoming.hangarSearch : merged.hangarSearch;
  merged.aircraftManagementFilter = typeof incoming.aircraftManagementFilter === "string" ? incoming.aircraftManagementFilter : merged.aircraftManagementFilter;
  merged.aircraftManagementSearch = typeof incoming.aircraftManagementSearch === "string" ? incoming.aircraftManagementSearch : merged.aircraftManagementSearch;
  merged.companyHangarFilter = typeof incoming.companyHangarFilter === "string" ? incoming.companyHangarFilter : merged.companyHangarFilter;
  merged.companyHangarSearch = typeof incoming.companyHangarSearch === "string" ? incoming.companyHangarSearch : merged.companyHangarSearch;
  merged.missionFilters = { ...merged.missionFilters, ...(incoming.missionFilters || {}) };
  const incomingSpeechVolume = Number(incoming.settings?.speechVolume);
  const incomingFreeModeCashSnapshot = incoming.settings?.freeModeCashSnapshot;
  const hasFreeModeCashSnapshot = incomingFreeModeCashSnapshot !== null
    && incomingFreeModeCashSnapshot !== undefined
    && Number.isFinite(Number(incomingFreeModeCashSnapshot));
  let migratedLegacyFreeModeCash = false;
  merged.settings = {
    ...merged.settings,
    speechVolume: Number.isFinite(incomingSpeechVolume)
      ? Math.max(0, Math.min(1, incomingSpeechVolume))
      : merged.settings.speechVolume,
    mapAutoTrack: incoming.settings?.mapAutoTrack === true,
    mapShowCompanyAircraft: incoming.settings?.mapShowCompanyAircraft !== false,
    mapLayer: normalizeMapLayer(incoming.settings?.mapLayer || merged.settings.mapLayer),
    darkMode: incoming.settings?.darkMode === true,
    freeMode: incoming.settings?.freeMode === true,
    freeModeCashSnapshot: hasFreeModeCashSnapshot
      ? Math.max(0, Number(incoming.settings.freeModeCashSnapshot))
      : null,
    sopMode: incoming.settings?.sopMode === true
  };
  if (merged.settings.freeMode) {
    if (merged.settings.freeModeCashSnapshot === null) {
      merged.settings.freeModeCashSnapshot = Math.max(0, Number(merged.cash) || 0);
      migratedLegacyFreeModeCash = merged.cash !== FREE_MODE_CASH;
      merged.cash = FREE_MODE_CASH;
    }
  } else {
    merged.settings.freeModeCashSnapshot = null;
  }
  const incomingCompany = incoming.company && typeof incoming.company === "object" ? incoming.company : {};
  merged.company = {
    ...merged.company,
    ...incomingCompany,
    created: incomingCompany.created === true,
    airlineId: airlines.some((airline) => airline.id === incomingCompany.airlineId) ? incomingCompany.airlineId : merged.company.airlineId,
    base: airportByIcao(incomingCompany.base) ? String(incomingCompany.base).toUpperCase() : merged.company.base,
    funds: Math.max(0, Number(incomingCompany.funds) || 0),
    pilots: Array.isArray(incomingCompany.pilots) ? incomingCompany.pilots.map(normalizeCompanyPilot) : [],
    applicants: Array.isArray(incomingCompany.applicants) ? normalizeCompanyApplicants(incomingCompany.applicants) : [],
    taskOffers: Array.isArray(incomingCompany.taskOffers) ? incomingCompany.taskOffers : [],
    tasks: Array.isArray(incomingCompany.tasks) ? incomingCompany.tasks : [],
    flightLogs: Array.isArray(incomingCompany.flightLogs) ? incomingCompany.flightLogs : [],
    aircraftIds: Array.isArray(incomingCompany.aircraftIds) ? incomingCompany.aircraftIds : [],
    starterAircraftGranted: incomingCompany.starterAircraftGranted === true,
    transactions: Array.isArray(incomingCompany.transactions) ? incomingCompany.transactions : [],
    activeSection: ["management", "tasks", "pilots", "recruitment", "hangar", "finance", "flight-log"].includes(incomingCompany.activeSection)
      ? incomingCompany.activeSection
      : "management"
  };
  merged.features = { ...merged.features, ...(incoming.features || {}) };
  if (!Object.prototype.hasOwnProperty.call(incoming.features || {}, "starterHelicopterGranted")) {
    merged.features.starterHelicopterGranted = false;
  }
  merged.logs = Array.isArray(incoming.logs) ? incoming.logs : merged.logs;
  merged.taskEvents = Array.isArray(incoming.taskEvents) ? incoming.taskEvents : merged.taskEvents;
  merged.fundTransactions = normalizeFundTransactions(incoming.fundTransactions, merged.cash);
  if (migratedLegacyFreeModeCash) {
    merged.fundTransactions.unshift({
      id: `fund-free-mode-migration-${Date.now()}`,
      date: Date.now(),
      type: "free-mode-adjustment",
      title: "自由模式临时资金",
      detail: "升级后自由模式个人余额临时调整为 100 万",
      amount: +(FREE_MODE_CASH - merged.settings.freeModeCashSnapshot).toFixed(2),
      balance: FREE_MODE_CASH,
      referenceId: ""
    });
    merged.fundTransactions = merged.fundTransactions.slice(0, 200);
  }
  merged.licenses = normalizeAircraftLicenses(incoming.licenses);
  merged.simulatorFlight = normalizeSimulatorFlight(incoming.simulatorFlight);
  if (Array.isArray(incoming.fleet)) {
    const catalogFleet = aircraftCatalog.map((aircraft) => {
      const found = incoming.fleet.find((item) => item.id === aircraft.id);
      return found
        ? normalizeFleetAircraft(aircraft, found)
        : normalizeFleetAircraft({ ...aircraft, owned: false, rented: false, selected: false });
    });
    const catalogIds = new Set(aircraftCatalog.map((aircraft) => aircraft.id));
    const customFleet = incoming.fleet
      .filter((item) => !catalogIds.has(item.id))
      .map((item) => {
        const template = aircraftCatalog.find((aircraft) => aircraft.id === item.catalogId) || {
          id: String(item.id),
          name: String(item.name || "公司飞机"),
          kind: String(item.kind || "干线喷气"),
          price: Number(item.price) || 0,
          rent: Number(item.rent) || 0,
          range: Number(item.range) || 0,
          pace: String(item.pace || "公司机队"),
          unlockHours: 0,
          note: String(item.note || "公司专属飞机")
        };
        return normalizeFleetAircraft(template, item);
      });
    merged.fleet = [...catalogFleet, ...customFleet];
  }
  if (Array.isArray(incoming.achievements)) {
    merged.achievements = achievementDefs.map((a) => {
      const found = incoming.achievements.find((item) => item.id === a.id);
      return found ? { id: a.id, unlocked: Boolean(found.unlocked) } : { id: a.id, unlocked: false };
    });
  }
  merged.activeView = ["dashboard", "missions", "map", "monitor", "schedules", "logs", "achievements", "profile", "hangar", "aircraft-management", "company"].includes(incoming.activeView) ? incoming.activeView : merged.activeView;
  return merged;
}

function normalizeBaseCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeAirportInputCode(value) {
  return String(value || "").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4);
}

function normalizeMission(mission, index = 0) {
  const category = String(mission?.category || "客运");
  const subtype = String(mission?.subtype || "常规航线");
  const origin = normalizeBaseCode(mission?.origin || "ZBAA");
  const destination = mission?.destination ? normalizeBaseCode(mission.destination) : "";
  const distance = Number(mission?.distance);
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : 100;
  const duration = Number(mission?.duration);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Math.max(0.6, +(safeDistance / 220).toFixed(1));
  return {
    ...mission,
    id: String(mission?.id || `mission-${index}`),
    title: String(mission?.title || `${origin}${destination ? ` → ${destination}` : " · 任务"}`),
    category,
    subtype,
    origin,
    destination: destination || null,
    route: String(mission?.route || (destination ? `${origin} → ${destination}` : `${origin} 基地周边航段`)),
    distance: safeDistance,
    duration: safeDuration,
    payout: Number.isFinite(Number(mission?.payout)) ? Number(mission.payout) : Math.round(1200 + safeDistance * 20),
    repGain: Number.isFinite(Number(mission?.repGain)) ? Number(mission.repGain) : Math.max(2, Math.round(safeDuration * 2)),
    risk: String(mission?.risk || "中"),
    weather: String(mission?.weather || "晴朗"),
    dispatchPhase: String(mission?.dispatchPhase || "日间"),
    aircraftHint: String(mission?.aircraftHint || "待指定"),
    summary: String(mission?.summary || `${category}任务 · ${subtype}`),
    priority: String(mission?.priority || (emergencyMissionCategories.includes(category) ? "emergency" : "standard")),
    refreshable: mission?.refreshable !== false,
    createdAt: Number.isFinite(Number(mission?.createdAt)) ? Number(mission.createdAt) : Date.now(),
    scene: mission?.scene || buildMissionScene(category, subtype)
  };
}

function normalizeAirlineCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
}

function missionBelongsToBase(mission, base = state?.pilot?.base) {
  return normalizeBaseCode(mission?.origin) === normalizeBaseCode(base);
}

function missionBelongsToAircraftLocation(mission) {
  const permitted = Array.isArray(mission?.permittedAircraftIds) ? mission.permittedAircraftIds : [];
  return permitted.some((id) => {
    const aircraft = state?.fleet?.find((item) => item.id === id);
    return aircraft && normalizeBaseCode(mission.origin) === normalizeBaseCode(aircraftOperationalBase(aircraft));
  });
}

function missionAircraftLocationMatches(mission) {
  if (mission?.originMode === "pilot-base") return true;
  const permitted = Array.isArray(mission?.permittedAircraftIds) ? mission.permittedAircraftIds : [];
  if (!permitted.length) return true;
  return permitted.some((id) => {
    const aircraft = state?.fleet?.find((item) => item.id === id);
    return aircraft && normalizeBaseCode(mission.origin) === normalizeBaseCode(aircraftOperationalBase(aircraft));
  });
}

function missionVisibleForBase(mission, base = state?.pilot?.base) {
  // Do not discard an accepted/completed mission when the pilot changes base.
  // Assessment and schedule records are fixed records, not refreshable offers.
  return mission?.status !== "open"
    || mission?.kind === "license-assessment"
    || mission?.refreshable === false
    || (missionAircraftLocationMatches(mission) && missionBelongsToBase(mission, base))
    || missionBelongsToAircraftLocation(mission);
}

function removeOpenMissionsOutsideBase(base = state?.pilot?.base) {
  const before = state.missions.length;
  state.missions = state.missions.filter((mission) => missionVisibleForBase(mission, base));
  return before - state.missions.length;
}

function isEmergencyMission(mission) {
  return emergencyMissionCategories.includes(mission?.category);
}

function refreshableMissionOffers(missions = state.missions, base = state?.pilot?.base) {
  return missions.filter((mission) => mission?.status === "open"
    && mission.refreshable !== false
    && missionAircraftLocationMatches(mission)
    && (missionBelongsToBase(mission, base) || missionBelongsToAircraftLocation(mission)));
}

function oldestExpiredMission(offers, now = Date.now()) {
  return offers
    .filter((mission) => now - Number(mission.createdAt || 0) >= MISSION_OFFER_LIFETIME_MS)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0] || null;
}

function uniqueTaskEvents(events) {
  const seen = new Set();
  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!event || typeof event !== "object") return false;
    const eventKeyValue = String(event.key || "").trim();
    if (!taskLogEventKeys.has(eventKeyValue) && !eventKeyValue.startsWith("sop-")) return false;
    const missionKey = String(event.missionTitle || event.missionId || "unknown").trim();
    const rawKey = String(event.key || event.title || event.detail || "unknown").trim();
    const eventKey = rawKey.startsWith("sop-") ? `${rawKey}:${String(event.detail || "").trim()}` : rawKey;
    const signature = `${missionKey}:${eventKey}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

// Renders call saveState() on every state change, including the 2s simulator poll.
// Writes are debounced so repeated calls coalesce into one clone+encrypt+disk write;
// awaiting saveState() still resolves only after the coalesced write has completed.
const SAVE_STATE_DEBOUNCE_MS = 800;
let saveStateTimer = 0;
let saveStateWaiters = [];

function persistStateNow() {
  if (saveStateTimer) {
    window.clearTimeout(saveStateTimer);
    saveStateTimer = 0;
  }
  if (!(saveStorageError && saveStorageHydrated)) {
    const snapshot = structuredClone(state);
    saveWriteChain = saveWriteChain
      .catch(() => {})
      .then(async () => {
        await writeStorageValue(STORAGE_KEY, await encryptSaveText(JSON.stringify(snapshot)));
      })
      .catch((error) => {
        saveStorageError = error;
      });
  }
  const waiters = saveStateWaiters;
  saveStateWaiters = [];
  for (const resolve of waiters) resolve(saveWriteChain);
  return saveWriteChain;
}

function saveState() {
  if (saveStorageError && saveStorageHydrated) return saveWriteChain;
  if (!saveStateTimer) saveStateTimer = window.setTimeout(persistStateNow, SAVE_STATE_DEBOUNCE_MS);
  return new Promise((resolve) => saveStateWaiters.push(resolve));
}

window.addEventListener("beforeunload", () => {
  if (saveStateTimer) persistStateNow();
});

function openingFundTransaction(balance, date = Date.now()) {
  const amount = Number.isFinite(Number(balance)) ? Number(balance) : 0;
  return {
    id: "fund-opening",
    date,
    type: "opening",
    title: "初始资金",
    detail: "职业生涯初始可用资金",
    amount,
    balance: amount,
    referenceId: ""
  };
}

function normalizeFundTransactions(transactions, currentBalance) {
  if (!Array.isArray(transactions) || !transactions.length) {
    return [{
      ...openingFundTransaction(currentBalance),
      title: "历史余额",
      detail: "升级前累计资金"
    }];
  }
  return transactions.slice(0, 200).map((transaction, index) => ({
    id: String(transaction?.id || `fund-history-${index}`),
    date: Number.isFinite(Number(transaction?.date)) ? Number(transaction.date) : Date.now(),
    type: String(transaction?.type || (Number(transaction?.amount) >= 0 ? "income" : "expense")),
    title: String(transaction?.title || "资金变动"),
    detail: String(transaction?.detail || ""),
    amount: Number.isFinite(Number(transaction?.amount)) ? Number(transaction.amount) : 0,
    balance: Number.isFinite(Number(transaction?.balance)) ? Number(transaction.balance) : Number(currentBalance) || 0,
    referenceId: String(transaction?.referenceId || "")
  }));
}

function normalizeAircraftLicenses(licenses) {
  const incoming = new Map((Array.isArray(licenses) ? licenses : []).map((license) => [String(license?.id || ""), license]));
  return aircraftLicenseCatalog.map((license) => {
    const found = incoming.get(license.id);
    // Saves from 1.0.95 treated payment as a completed rating. Preserve those
    // historical ratings while requiring the new assessment for fresh purchases.
    const legacyLicensed = found?.purchased === true
      && !Object.prototype.hasOwnProperty.call(found || {}, "assessmentCompleted");
    return {
      id: license.id,
      purchased: found?.purchased === true,
      purchasedAt: Number.isFinite(Number(found?.purchasedAt)) ? Number(found.purchasedAt) : null,
      assessmentCompleted: found?.assessmentCompleted === true || legacyLicensed,
      assessmentCompletedAt: Number.isFinite(Number(found?.assessmentCompletedAt))
        ? Number(found.assessmentCompletedAt)
        : legacyLicensed ? (Number.isFinite(Number(found?.purchasedAt)) ? Number(found.purchasedAt) : null) : null,
      assessmentMissionId: String(found?.assessmentMissionId || "")
    };
  });
}

function aircraftLicense(id) {
  return aircraftLicenseCatalog.find((license) => license.id === id) || null;
}

function hasAircraftLicense(id) {
  return state.licenses?.some((license) => license.id === id && license.purchased && license.assessmentCompleted) === true;
}

function isFreeMode() {
  return state.settings?.freeMode === true;
}

function applyFreeModeFinancialState(enabled) {
  const nextEnabled = enabled === true;
  if (nextEnabled === isFreeMode()) return false;
  if (nextEnabled) {
    state.settings.freeModeCashSnapshot = Math.max(0, Number(state.cash) || 0);
    state.settings.freeMode = true;
    const adjustment = +(FREE_MODE_CASH - Number(state.cash || 0)).toFixed(2);
    if (adjustment !== 0) {
      recordFundTransaction({
        amount: adjustment,
        type: "free-mode-adjustment",
        title: "自由模式临时资金",
        detail: "自由模式开启，个人余额临时调整为 100 万"
      });
    }
    return true;
  }
  const restoredCash = state.settings.freeModeCashSnapshot !== null
    && state.settings.freeModeCashSnapshot !== undefined
    && Number.isFinite(Number(state.settings.freeModeCashSnapshot))
    ? Math.max(0, Number(state.settings.freeModeCashSnapshot))
    : 25_000;
  state.settings.freeMode = false;
  state.settings.freeModeCashSnapshot = null;
  const adjustment = +(restoredCash - Number(state.cash || 0)).toFixed(2);
  if (adjustment !== 0) {
    recordFundTransaction({
      amount: adjustment,
      type: "free-mode-adjustment",
      title: "恢复职业模式资金",
      detail: "自由模式关闭，恢复开启前的个人余额"
    });
  }
  return true;
}

function isSopMode() {
  return state.settings?.sopMode === true && !isFreeMode();
}

function missionEligibleAircraft() {
  if (isFreeMode()) {
    return aircraftCatalog;
  }
  return (Array.isArray(state.fleet) ? state.fleet : [])
    .filter((aircraft) => !isCompanyAircraft(aircraft)
      && (aircraft.owned || aircraft.rented)
      && (hasAircraftLicense(aircraft.catalogId || aircraft.id)
        || (aircraft.catalogId || aircraft.id) === "c172"
        || (aircraft.catalogId || aircraft.id) === STARTER_HELICOPTER_ID));
}

function activeLicenseAssessment(id) {
  const record = state.licenses.find((license) => license.id === id);
  return state.missions.find((mission) => mission?.kind === "license-assessment"
    && (mission.licenseAssessmentId === id || (record?.assessmentMissionId && mission.id === record.assessmentMissionId))
    && mission.status !== "completed") || null;
}

function createLicenseAssessmentMission(license) {
  const aircraft = state.fleet.find((item) => !isCompanyAircraft(item)
    && (item.owned || item.rented)
    && (item.catalogId || item.id) === license.id)
    || state.fleet.find((item) => item.id === license.id);
  if (!aircraft) return null;
  const mission = makeMission("包机", `${license.name} 型别考核`, 0, aircraft);
  if (!mission) return null;
  mission.kind = "license-assessment";
  mission.licenseAssessmentId = license.id;
  mission.assessmentAircraftId = license.id;
  mission.title = `${license.name} 型别考核`;
  mission.summary = `机型执照考核 · 使用 ${license.name} 完成指定机场航段`;
  mission.aircraftHint = license.name;
  mission.permittedAircraftIds = [aircraft.id];
  mission.payout = 0;
  mission.repGain = 0;
  mission.priority = "assessment";
  mission.refreshable = false;
  mission.assessmentBrief = `使用 ${license.name} 从 ${mission.origin} 起飞，在 ${mission.destination} 落地并关车。`;
  return mission;
}

function ensureLicenseAssessmentMissions() {
  let added = 0;
  state.licenses.forEach((record) => {
    if (!record?.purchased || record.assessmentCompleted || activeLicenseAssessment(record.id)) return;
    const license = aircraftLicense(record.id);
    const assessment = license && createLicenseAssessmentMission(license);
    if (!assessment) return;
    state.missions.unshift(assessment);
    record.assessmentMissionId = assessment.id;
    added += 1;
  });
  return added;
}

function refreshLicenseAssessmentMissions() {
  const pending = state.licenses.filter((record) => record?.purchased && !record.assessmentCompleted);
  if (!pending.length) {
    toast("当前没有待完成的机型考核");
    return;
  }

  const added = ensureLicenseAssessmentMissions();
  const available = pending.map((record) => {
    const mission = activeLicenseAssessment(record.id);
    if (mission) {
      record.assessmentMissionId = mission.id;
      mission.licenseAssessmentId = record.id;
      mission.assessmentAircraftId ||= record.id;
    }
    return mission;
  }).filter(Boolean);

  saveState();
  if (!available.length) {
    renderAircraftLicenses();
    wireIcons();
    toast("未能生成考核任务，请先确认已拥有或租用对应机型");
    return;
  }

  state.missionFilters = { ...state.missionFilters, search: "", status: "all", category: "all" };
  state.activeView = "missions";
  renderAll();
  toast(added > 0
    ? `已恢复 ${added} 个考核任务，已打开任务列表`
    : `考核任务已刷新，共 ${available.length} 个，已打开任务列表`);
}

function purchaseAircraftLicense(id) {
  const license = aircraftLicense(id);
  const record = state.licenses.find((item) => item.id === id);
  if (!license || !record) return;
  if (hasAircraftLicense(id)) {
    toast(`${license.name} 已取得正式执照`);
    return;
  }
  if (record.purchased) {
    if (!activeLicenseAssessment(id)) {
      const assessment = createLicenseAssessmentMission(license);
      if (assessment) {
        state.missions.unshift(assessment);
        record.assessmentMissionId = assessment.id;
        renderAll();
      }
    }
    toast(`${license.name} 考核任务尚未完成`);
    return;
  }
  if (state.cash < license.cost) {
    toast("资金不足，无法购买执照");
    return;
  }
  recordFundTransaction({
    amount: -license.cost,
    type: "license-expense",
    title: "购买机型执照",
    detail: `${license.name} · ${license.kind}`,
    referenceId: license.id
  });
  record.purchased = true;
  record.purchasedAt = Date.now();
  record.assessmentCompleted = false;
  record.assessmentCompletedAt = null;
  const assessment = createLicenseAssessmentMission(license);
  if (assessment) {
    state.missions.unshift(assessment);
    record.assessmentMissionId = assessment.id;
    toast(`已购买 ${license.name} 考核资格，请完成机型考核任务`);
  } else {
    toast(`已购买 ${license.name} 考核资格，但暂时无法生成任务，请稍后重试`);
  }
  renderAll();
}

function recordFundTransaction({ amount, type, title, detail = "", referenceId = "", date = Date.now() }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) return null;
  state.cash = +(Number(state.cash || 0) + value).toFixed(2);
  const transaction = {
    id: cryptoId("fund"),
    date,
    type: type || (value > 0 ? "income" : "expense"),
    title: String(title || "资金变动"),
    detail: String(detail || ""),
    amount: +value.toFixed(2),
    balance: state.cash,
    referenceId: String(referenceId || "")
  };
  if (!Array.isArray(state.fundTransactions)) state.fundTransactions = [];
  state.fundTransactions.unshift(transaction);
  state.fundTransactions = state.fundTransactions.slice(0, 200);
  return transaction;
}

function emptySimulatorFlight(lastGroundAirport = "", lastGroundFuelKg = null) {
  return {
    active: false,
    aircraftId: "",
    aircraftName: "",
    missionId: "",
    departedAt: null,
    origin: "",
    lastGroundAirport: String(lastGroundAirport || ""),
    lastGroundFuelKg: Number.isFinite(Number(lastGroundFuelKg)) ? Math.max(0, Number(lastGroundFuelKg)) : null,
    fuelStartKg: null,
    lastFuelKg: null,
    fuelUsedKg: 0,
    fuelAddedKg: 0,
    lastPoint: null,
    distanceNm: 0,
    lastSampleAt: null
  };
}

function normalizeSimulatorFlight(value) {
  const base = emptySimulatorFlight(value?.lastGroundAirport, value?.lastGroundFuelKg);
  if (!value || typeof value !== "object") return base;
  const point = value.lastPoint;
  return {
    ...base,
    active: value.active === true,
    aircraftId: String(value.aircraftId || ""),
    aircraftName: String(value.aircraftName || ""),
    missionId: String(value.missionId || ""),
    departedAt: Number.isFinite(Number(value.departedAt)) ? Number(value.departedAt) : null,
    origin: String(value.origin || ""),
    fuelStartKg: Number.isFinite(Number(value.fuelStartKg)) ? Math.max(0, Number(value.fuelStartKg)) : null,
    lastFuelKg: Number.isFinite(Number(value.lastFuelKg)) ? Math.max(0, Number(value.lastFuelKg)) : null,
    fuelUsedKg: Math.max(0, Number(value.fuelUsedKg) || 0),
    fuelAddedKg: Math.max(0, Number(value.fuelAddedKg) || 0),
    lastPoint: Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lon))
      ? { lat: Number(point.lat), lon: Number(point.lon) }
      : null,
    distanceNm: Math.max(0, Number(value.distanceNm) || 0),
    lastSampleAt: Number.isFinite(Number(value.lastSampleAt)) ? Number(value.lastSampleAt) : null
  };
}

function isStarterAircraft(aircraftId) {
  return aircraftId === "c172" || aircraftId === STARTER_HELICOPTER_ID;
}

function grantStarterHelicopter(targetState) {
  const helicopter = targetState.fleet.find((aircraft) => aircraft.id === STARTER_HELICOPTER_ID);
  let changed = false;
  if (helicopter) {
    if (helicopter.price !== 0 || helicopter.rent !== 0 || helicopter.unlockHours !== 0) {
      helicopter.price = 0;
      helicopter.rent = 0;
      helicopter.unlockHours = 0;
      changed = true;
    }
  }
  if (targetState.features?.starterHelicopterGranted) return changed;
  if (helicopter) {
    if (!helicopter.owned || helicopter.rented) changed = true;
    helicopter.owned = true;
    helicopter.rented = false;
  }
  targetState.features = { ...(targetState.features || {}), starterHelicopterGranted: true };
  return true;
}

function seedMissions() {
  return [
    makeMission("客运", "区域通勤", 0),
    makeMission("货运", "轻货转运", 0),
    makeMission("包机", "商务包机", 8)
  ].map((mission, index) => ({
    ...mission,
    id: cryptoId(`seed-${index}`),
    status: index === 0 ? "open" : "open",
    acceptedAt: null,
    completedAt: null
  }));
}

function cryptoId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function aircraftCatalogId(aircraft) {
  return String(aircraft?.catalogId || aircraft?.id || "");
}

function createPersonalAircraft(catalogId, ownership = "owned") {
  const template = aircraftCatalog.find((aircraft) => aircraft.id === catalogId);
  if (!template) return null;
  return normalizeFleetAircraft(template, {
    id: cryptoId(`personal-${template.id}`),
    catalogId: template.id,
    companyOwned: false,
    owned: ownership === "owned",
    rented: ownership === "rented",
    selected: false,
    conditionPercent: 100
  });
}

function aircraftFleetNumber(aircraft) {
  const suffix = String(aircraft?.id || "").split("-").at(-1).slice(-6).toUpperCase();
  return suffix || aircraftCatalogId(aircraft).toUpperCase() || "未编号";
}

function getRankInfo(hours) {
  for (let i = rankRules.length - 1; i >= 0; i--) {
    if (hours >= rankRules[i].minHours) return rankRules[i];
  }
  return rankRules[0];
}

function currentAirline() {
  const airlineId = state?.airlineId || airlines[0].id;
  return airlines.find((item) => item.id === airlineId) || airlines[0];
}

function companyAirline() {
  const airlineId = state?.company?.airlineId || state?.airlineId || airlines[0].id;
  return airlines.find((item) => item.id === airlineId) || airlines[0];
}

function companyBase() {
  return companyAirportByIcao(state?.company?.base || state?.pilot?.base || "ZBAA");
}

function companyAirportByIcao(icao) {
  return globalAirportIndex.get(String(icao || "").trim().toUpperCase()) || null;
}

function aircraftOperationalBase(aircraft, fallback = state?.pilot?.base || "ZBAA") {
  const lastAirport = normalizeBaseCode(aircraft?.lastLandingAirport);
  if (lastAirport && airportByIcao(lastAirport)) return lastAirport;
  const fallbackCode = normalizeBaseCode(fallback);
  return airportByIcao(fallbackCode) ? fallbackCode : "ZBAA";
}

function companyAirportLabel(airport) {
  return airport ? `${airport.icao} · ${airport.name}` : "请输入有效的四字 ICAO 机场代码";
}

function companyMissionDestinations(base) {
  const operationalTypes = new Set(["large_airport", "medium_airport", "small_airport", "seaplane_base"]);
  const nearby = globalAirportDatabase
    .filter((airport) => airport.icao !== base.icao && operationalTypes.has(airport.type))
    .map((airport) => ({ ...airport, distance: distanceNm(base, airport) }))
    .filter((airport) => airport.distance >= 20 && airport.distance <= 1200);
  const scheduled = nearby.filter((airport) => airport.scheduled);
  return scheduled.length >= 20 ? scheduled : nearby.length ? nearby : airportDatabase.filter((airport) => airport.icao !== base.icao);
}

function companyManagedFleet() {
  if (!state?.company?.created) return [];
  const available = state.fleet.filter((aircraft) => aircraft.companyOwned || aircraft.owned || aircraft.rented);
  const availableIds = new Set(available.map((aircraft) => aircraft.id));
  state.company.aircraftIds = [...new Set([
    ...(Array.isArray(state.company.aircraftIds) ? state.company.aircraftIds : []),
    ...available.map((aircraft) => aircraft.id)
  ])].filter((id) => availableIds.has(id));
  return state.company.aircraftIds.map((id) => state.fleet.find((aircraft) => aircraft.id === id)).filter(Boolean);
}

function isCompanyAircraft(aircraft) {
  return aircraft?.companyOwned === true;
}

function createCompanyAircraft(selectedId = "") {
  const candidates = aircraftCatalog.filter((aircraft) => aircraft.kind === "干线喷气");
  const template = candidates.find((aircraft) => aircraft.id === selectedId) || pick(candidates);
  if (!template) return null;
  return normalizeFleetAircraft(template, {
    id: `company-aircraft-${template.id}-${cryptoId("fleet")}`,
    catalogId: template.id,
    companyOwned: true,
    owned: true,
    rented: false,
    selected: false,
    price: template.price,
    conditionPercent: 100
  });
}

function companyHangarIsActive() {
  return state.activeView === "company" && state.company?.created === true && state.company?.activeSection === "hangar";
}

function companyTransaction({ amount, type, title, detail = "", referenceId = "", date = Date.now() }) {
  if (!state.company?.created) return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) return null;
  state.company.funds = +(Math.max(0, Number(state.company.funds || 0) + value)).toFixed(2);
  const transaction = {
    id: cryptoId("company-fund"),
    date,
    type: type || (value > 0 ? "income" : "expense"),
    title: String(title || "公司资金变动"),
    detail: String(detail || ""),
    amount: +value.toFixed(2),
    balance: state.company.funds,
    referenceId: String(referenceId || "")
  };
  state.company.transactions.unshift(transaction);
  state.company.transactions = state.company.transactions.slice(0, 200);
  return transaction;
}

function companyApplicantName(usedNames = new Set()) {
  const available = companyPilotNames.filter((name) => !usedNames.has(name));
  const name = pick(available.length ? available : companyPilotNames);
  usedNames.add(name);
  return name;
}

function normalizeAircraftKinds(value, fallback = "训练机") {
  const rawValues = Array.isArray(value) ? value : String(value || "").split(/[、,，/|]+/);
  const values = [...new Set(rawValues.map((item) => String(item || "").trim()).filter(Boolean))];
  return values.length ? values : [fallback];
}

function pilotAircraftKinds(pilot) {
  return normalizeAircraftKinds(pilot?.aircraftKinds || pilot?.aircraftKind);
}

function pilotCanOperateAircraft(pilot, aircraft) {
  const kind = String(aircraft?.kind || "").trim();
  return Boolean(kind) && pilotAircraftKinds(pilot).includes(kind);
}

function selectApplicantAircraftKinds(skillLevel) {
  const level = Math.max(1, Math.min(5, Number(skillLevel) || 1));
  const maxKinds = Math.min(companyPilotKinds.length, level >= 4 ? 3 : 2);
  const count = rand(2, maxKinds);
  const kinds = [];
  while (kinds.length < count) {
    const kind = pick(companyPilotKinds);
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

function companyApplicant(usedNames = new Set()) {
  const skillLevel = rand(1, 5);
  const aircraftKinds = selectApplicantAircraftKinds(skillLevel);
  const name = companyApplicantName(usedNames);
  return {
    id: cryptoId("applicant"),
    name: `${name}${rand(1, 9)}`,
    skillLevel,
    skill: 45 + skillLevel * 10 + rand(0, 9),
    aircraftKinds,
    aircraftKind: aircraftKinds[0],
    hirePrice: 4000 + skillLevel * 3500,
    salary: 500 + skillLevel * 180,
    experienceHours: skillLevel * 18 + rand(0, 20),
    generatedAt: Date.now()
  };
}

function companyApplicants(count = 6) {
  const usedNames = new Set();
  return Array.from({ length: count }, () => companyApplicant(usedNames));
}

function companyMissionOffer(aircraft = null) {
  const fleet = state?.company?.created
    ? state.fleet.filter((item) => isCompanyAircraft(item) && (item.owned || item.rented))
    : [];
  const selectedAircraft = aircraft || pick(fleet) || null;
  const baseCode = aircraftOperationalBase(selectedAircraft, state.company?.base || state.pilot?.base || "ZBAA");
  const base = companyAirportByIcao(baseCode) || companyBase() || airportDatabase[0];
  const destinations = companyMissionDestinations(base);
  const destination = pick(destinations);
  const category = pick(companyTaskCategories);
  const miles = Math.max(20, Math.round(distanceNm(base, destination)));
  const multiplier = { 货运: 18, 医疗: 20, 搜救: 22, 观光: 12, 包机: 16, 客运: 14 }[category] || 14;
  return {
    id: cryptoId("company-offer"),
    title: `${category} · ${base.icao} → ${destination.icao}`,
    origin: base.icao,
    destination: destination.icao,
    aircraftId: selectedAircraft?.id || "",
    aircraftHint: selectedAircraft?.name || "公司机队可用机型",
    category,
    distance: miles,
    payout: Math.round(1200 + miles * multiplier),
    status: "open",
    createdAt: Date.now()
  };
}

function createCompanyPilot(applicant, owner = false) {
  const aircraftKinds = normalizeAircraftKinds(applicant.aircraftKinds || applicant.aircraftKind);
  return {
    id: cryptoId("pilot"),
    name: String(applicant.name || "公司飞行员"),
    skillLevel: Math.max(1, Number(applicant.skillLevel) || 1),
    skill: Math.max(1, Number(applicant.skill) || 50),
    aircraftKinds,
    aircraftKind: aircraftKinds[0],
    salary: Math.max(0, Number(applicant.salary) || 500),
    experienceHours: Math.max(0, Number(applicant.experienceHours) || 0),
    status: "active",
    owner,
    assignedTaskId: "",
    hiredAt: Date.now()
  };
}

function normalizeCompanyPilot(pilot, index = 0) {
  const aircraftKinds = normalizeAircraftKinds(pilot?.aircraftKinds || pilot?.aircraftKind);
  return {
    id: String(pilot?.id || `pilot-${index}`),
    name: String(pilot?.name || "公司飞行员"),
    skillLevel: Math.max(1, Math.min(5, Number(pilot?.skillLevel) || 1)),
    skill: Math.max(1, Math.min(100, Number(pilot?.skill) || 50)),
    aircraftKinds,
    aircraftKind: aircraftKinds[0],
    salary: Math.max(0, Number(pilot?.salary) || 500),
    experienceHours: Math.max(0, Number(pilot?.experienceHours) || 0),
    status: pilot?.status === "fired" ? "fired" : "active",
    owner: pilot?.owner === true,
    assignedTaskId: String(pilot?.assignedTaskId || ""),
    hiredAt: Number.isFinite(Number(pilot?.hiredAt)) ? Number(pilot.hiredAt) : Date.now()
  };
}

function normalizeCompanyApplicant(applicant, index = 0, usedNames = new Set()) {
  const rawName = String(applicant?.name || "候选飞行员").trim().replace(/\d+$/, "").trim() || "候选飞行员";
  const alternatives = [...companyPilotNames, ...companyPilotFallbackNames].filter((name) => !usedNames.has(name));
  const name = usedNames.has(rawName) ? pick(alternatives) || rawName : rawName;
  usedNames.add(name);
  const aircraftKinds = normalizeAircraftKinds(applicant?.aircraftKinds || applicant?.aircraftKind);
  return {
    id: String(applicant?.id || `applicant-${index}`),
    name,
    skillLevel: Math.max(1, Math.min(5, Number(applicant?.skillLevel) || 1)),
    skill: Math.max(1, Math.min(100, Number(applicant?.skill) || 50)),
    aircraftKinds,
    aircraftKind: aircraftKinds[0],
    hirePrice: Math.max(0, Number(applicant?.hirePrice) || 4000),
    salary: Math.max(0, Number(applicant?.salary) || 500),
    experienceHours: Math.max(0, Number(applicant?.experienceHours) || 0),
    generatedAt: Number.isFinite(Number(applicant?.generatedAt)) ? Number(applicant.generatedAt) : Date.now()
  };
}

function normalizeCompanyApplicants(applicants) {
  const usedNames = new Set();
  return (Array.isArray(applicants) ? applicants : []).map((applicant, index) => normalizeCompanyApplicant(applicant, index, usedNames));
}

function currentAircraft() {
  const personalFleet = state?.fleet?.filter((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented)) || [];
  if (!personalFleet.length) {
    return aircraftCatalog.find((aircraft) => aircraft.id === "c172") || aircraftCatalog[0];
  }
  return personalFleet.find((item) => item.selected) || personalFleet[0];
}

function selectedMissions() {
  return state.missions.filter((mission) => mission.status !== "completed");
}

function buildMissionScene(category, subtype) {
  const packagedScene = flightCareerMissionScenes[subtype];
  if (packagedScene) {
    const modelPolicy = missionSceneModelPolicies[packagedScene.objectTitle] || {};
    const requiresLanding = packagedScene.requiresLanding ?? modelPolicy.requiresLanding ?? packagedScene.arrivalMode === "landing";
    return {
      ...modelPolicy,
      ...packagedScene,
      requiresLanding,
      arrivalMode: requiresLanding ? "landing" : "low-altitude",
      source: "Flight Career Objects 1.0.0",
      animated: packagedScene.seconds > 0,
      phase: "briefed"
    };
  }
  const standard = standardMissionScenes[category] || standardMissionScenes.客运;
  return {
    ...standard,
    source: "航路任务",
    objectTitle: "",
    clip: "航路状态动画",
    seconds: 2.5,
    radiusNm: 0,
    animated: true,
    phase: "briefed"
  };
}

function missionScene(mission) {
  return mission.scene || buildMissionScene(mission.category, mission.subtype);
}

function missionSceneModelPolicy(mission) {
  const packaged = flightCareerMissionScenes[mission?.subtype] || {};
  const scene = mission?.scene || {};
  return missionSceneModelPolicies[packaged.objectTitle || scene.objectTitle] || {};
}

function missionTerrainType(mission) {
  if (mission?.destination) return "airport";
  const packaged = flightCareerMissionScenes[mission?.subtype] || {};
  const scene = mission?.scene || {};
  return packaged.terrain || missionSceneModelPolicy(mission).terrain || scene.terrain || mission?.site?.terrain || "land";
}

function missionRequiresLanding(mission) {
  if (mission?.destination) return true;
  const packaged = flightCareerMissionScenes[mission?.subtype] || {};
  const modelPolicy = missionSceneModelPolicy(mission);
  const scene = mission?.scene || {};
  if (typeof packaged.requiresLanding === "boolean") return packaged.requiresLanding;
  if (typeof modelPolicy.requiresLanding === "boolean") return modelPolicy.requiresLanding;
  if (typeof scene.requiresLanding === "boolean") return scene.requiresLanding;
  return (packaged.arrivalMode || scene.arrivalMode || "landing") === "landing";
}

function missionArrivalMode(mission) {
  return missionRequiresLanding(mission) ? "landing" : "low-altitude";
}

function hasDepartedTaskSite(onGround, groundSpeedKt) {
  return !onGround && Number(groundSpeedKt || 0) >= 20;
}

function missionArrivalRule(mission) {
  if (mission?.destination) return { kind: "airport", radiusNm: 4, dwellSeconds: 0, speedLimitKt: 30 };
  return missionArrivalRules[missionArrivalMode(mission)] || missionArrivalRules.landing;
}

function missionArrivalLabel(mission) {
  const rule = missionArrivalRule(mission);
  if (rule.kind === "airport") return "目的机场落地并关车";
  if (missionArrivalMode(mission) === "low-altitude") return `低空进入 ${rule.radiusNm} nm 内触发`;
  return `落地后 ${rule.radiusNm} nm 内停留 ${rule.dwellSeconds} 秒`;
}

function missionTerrainLabel(mission) {
  const terrain = missionTerrainType(mission);
  if (terrain === "airport") return "机场任务 · 必须降落";
  if (terrain === "water") return `海上模型 · ${missionRequiresLanding(mission) ? "必须水面降落" : "低空作业"}`;
  return `地面模型 · ${missionRequiresLanding(mission) ? "必须降落" : "低空作业"}`;
}

function isPackagedScene(scene) {
  return Boolean(scene?.objectTitle);
}

function missionSmokeTitle(scene) {
  return scene?.animated && scene?.objectTitle ? (scene.smokeTitle || "FCMsmoke1") : "";
}

function airportByIcao(icao) {
  const code = String(icao || "").trim().toUpperCase();
  return globalAirportIndex.get(code) || airportDatabase.find((airport) => airport.icao === code) || null;
}

function distanceNm(from, to) {
  const radiusNm = 3440.065;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const deltaLat = (to.lat - from.lat) * Math.PI / 180;
  const deltaLon = (to.lon - from.lon) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return radiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function assessTelemetryMovement(previousPoint, currentPoint, previousTimestamp, currentTimestamp, sample = {}) {
  if (!previousPoint || !currentPoint) return { kind: "unavailable", stepNm: 0, elapsedSec: 0, plausibleStepNm: 0 };
  const coordinates = [previousPoint.lat, previousPoint.lon, currentPoint.lat, currentPoint.lon].map(Number);
  if (!coordinates.every(Number.isFinite)) return { kind: "unavailable", stepNm: 0, elapsedSec: 0, plausibleStepNm: 0 };
  const stepNm = distanceNm(previousPoint, currentPoint);
  const previousAt = Number(previousTimestamp);
  const currentAt = Number(currentTimestamp);
  const elapsedSec = Number.isFinite(previousAt) && Number.isFinite(currentAt) ? (currentAt - previousAt) / 1000 : 0;
  const speedKt = Math.max(
    Number(sample.groundSpeedKt) || 0,
    Number(sample.indicatedAirspeedKt) || 0,
    Number(sample.trueAirspeedKt) || 0
  );
  const plausibleStepNm = Math.max(3, speedKt * Math.max(1, elapsedSec) / 3600 * 5 + 1);
  if (telemetryBoolean(sample.slewActive)) return { kind: "slew", stepNm, elapsedSec, plausibleStepNm };
  if (!(elapsedSec > 0) || elapsedSec > 120) return { kind: "gap", stepNm, elapsedSec, plausibleStepNm };
  if (stepNm > 8 && stepNm > plausibleStepNm) return { kind: "jump", stepNm, elapsedSec, plausibleStepNm };
  return { kind: "normal", stepNm, elapsedSec, plausibleStepNm };
}

function accumulateFlightDistance(current, step) {
  const total = Math.max(0, Number(current) || 0);
  const increment = Number(step);
  if (!Number.isFinite(increment) || increment <= 0) return total;
  return +(total + increment).toFixed(6);
}

function nearestKnownAirport(lat, lon, maximumNm = 4) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const point = { lat, lon };
  const nearest = airportDatabase.reduce((best, airport) => {
    const distance = distanceNm(point, airport);
    return !best || distance < best.distance ? { airport, distance } : best;
  }, null);
  return nearest?.distance <= maximumNm ? nearest : null;
}

function compactAircraftName(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function aircraftIdentityTokens(value) {
  const compact = compactAircraftName(value);
  if (!compact) return [];
  const tokens = [compact];
  // Ignore vendor prefixes and paint/package suffixes such as FenixA319 CFM SL HD.
  const modelCodes = ["A319NEO", "A321NEO", "A320NEO", "A319", "A320", "A321"];
  modelCodes.forEach((code) => {
    const baseFamilyCode = /^(A319|A320|A321)$/.test(code);
    const hasNeoVariant = /A(?:319|320|321)(?:NEO|LR)/.test(compact);
    if (compact.includes(code) && !(baseFamilyCode && hasNeoVariant)) tokens.push(code);
  });
  return [...new Set(tokens)];
}

function telemetryAircraftValues(sample) {
  return [
    sample?.aircraftTypeCode, sample?.aircraftModel, sample?.aircraftTitle, sample?.loadedAircraftName,
    sample?.AircraftTypeCode, sample?.AircraftModel, sample?.AircraftTitle, sample?.LoadedAircraftName
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function telemetryAircraftLabel(sample) {
  return String(sample?.aircraftTitle || sample?.aircraftModel || sample?.aircraftTypeCode || sample?.loadedAircraftName || "").trim();
}

const aircraftVariantFamilies = [
  { base: ["A319", "AIRBUSA319"], neo: ["A19N", "A319NEO", "AIRBUSA319NEO"] },
  { base: ["A320", "AIRBUSA320"], neo: ["A20N", "A320NEO", "AIRBUSA320NEO"] },
  { base: ["A321", "AIRBUSA321"], neo: ["A21N", "A321NEO", "A321LR", "AIRBUSA321NEO", "AIRBUSA321LR"] }
];

function aircraftVariantConflict(actual, alias) {
  const pittsVariant = actual.includes("S1S") ? "S1S" : actual.includes("S2S") ? "S2S" : "";
  if (pittsVariant && alias === "PITTS") return true;
  if (actual.includes("AEROBAT") && ["C152", "CESSNA152"].includes(alias)) return true;
  return aircraftVariantFamilies.some((family) => {
    const actualVariant = family.neo.some((token) => actual.includes(token)) ? "neo" : family.base.some((token) => actual.includes(token)) ? "base" : "";
    const aliasVariant = family.neo.some((token) => alias.includes(token)) ? "neo" : family.base.some((token) => alias.includes(token)) ? "base" : "";
    return actualVariant && aliasVariant && actualVariant !== aliasVariant;
  });
}

function telemetryBoolean(value) {
  if (typeof value === "string") return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  return value === true || value === 1;
}

function telemetryMatchesAircraft(sample, aircraft) {
  const actualTokens = telemetryAircraftValues(sample).flatMap(aircraftIdentityTokens);
  if (!actualTokens.length) return false;
  const identityId = aircraft?.catalogId || aircraft?.id;
  const aliases = [
    ...(aircraftIdentityRules[identityId] || []),
    compactAircraftName(aircraft?.name),
    compactAircraftName(identityId)
  ].flatMap(aircraftIdentityTokens).filter((value) => value.length >= 3);
  return aliases.some((alias) => actualTokens.some((actual) => !aircraftVariantConflict(actual, alias) && (actual === alias || (alias.length >= 4 && actual.includes(alias)))));
}

function telemetryFuelKg(sample) {
  if (sample?.fuelKg === null || sample?.fuelKg === undefined || sample?.fuelKg === "") return null;
  const value = Number(sample.fuelKg);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function telemetryFuelCapacityKg(sample) {
  if (sample?.fuelCapacityKg === null || sample?.fuelCapacityKg === undefined || sample?.fuelCapacityKg === "") return null;
  const value = Number(sample.fuelCapacityKg);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function fuelSliderState(currentFuelPercent, requestedTargetPercent, targetBaselinePercent) {
  const minimumPercent = currentFuelPercent === null || currentFuelPercent === undefined
    ? 0
    : Math.max(0, Math.min(100, Math.ceil(Number(currentFuelPercent) || 0)));
  const hasRequestedTarget = requestedTargetPercent !== null
    && requestedTargetPercent !== undefined
    && Number.isFinite(Number(requestedTargetPercent));
  const baselineMatches = Number.isFinite(Number(targetBaselinePercent))
    && Number(targetBaselinePercent) === minimumPercent;
  const usesRequestedTarget = hasRequestedTarget && baselineMatches;
  const targetPercent = usesRequestedTarget
    ? Math.max(minimumPercent, Math.min(100, Number(requestedTargetPercent)))
    : minimumPercent;
  return { minimumPercent, targetPercent, usesRequestedTarget };
}

function telemetryFleetAircraft(sample) {
  if (!sample || !state?.fleet?.length) return null;
  const matches = state.fleet.filter((aircraft) => telemetryMatchesAircraft(sample, aircraft));
  return matches.find((aircraft) => aircraft.selected)
    || matches.find((aircraft) => aircraft.owned || aircraft.rented)
    || matches[0]
    || null;
}

function syncFleetTelemetry(sample) {
  const aircraft = telemetryFleetAircraft(sample);
  const fuelKg = telemetryFuelKg(sample);
  if (!aircraft || fuelKg === null) return aircraft;
  aircraft.lastFuelKg = +fuelKg.toFixed(2);
  const capacityKg = telemetryFuelCapacityKg(sample);
  if (capacityKg !== null) aircraft.fuelCapacityKg = +capacityKg.toFixed(2);
  aircraft.lastFuelAt = Date.now();
  aircraft.lastSeenTitle = telemetryAircraftLabel(sample);
  return aircraft;
}

function updateMissionFuel(verification, sample) {
  const fuelKg = telemetryFuelKg(sample);
  if (!verification || fuelKg === null) return null;
  const preflight = !verification.departedAt
    && ["briefed", "origin-confirmed"].includes(verification.phase);
  const previous = Number(verification.fuelLastKg);
  if (preflight || !Number.isFinite(previous)) {
    verification.fuelStartKg = fuelKg;
    verification.fuelUsedKg = 0;
    verification.fuelAddedKg = 0;
  } else {
    const change = previous - fuelKg;
    const plausibleDrop = Math.max(50, previous * 0.25);
    if (change > 0 && change <= plausibleDrop) {
      verification.fuelUsedKg = +(Number(verification.fuelUsedKg || 0) + change).toFixed(2);
    } else if (change < 0) {
      verification.fuelAddedKg = +(Number(verification.fuelAddedKg || 0) + Math.abs(change)).toFixed(2);
    }
  }
  verification.fuelCurrentKg = fuelKg;
  verification.fuelLastKg = fuelKg;
  verification.fuelUpdatedAt = Date.now();
  return fuelKg;
}

function missionAircraft(mission) {
  const aircraftId = mission?.verification?.aircraftId || mission?.permittedAircraftIds?.[0];
  return state.fleet.find((aircraft) => aircraft.id === aircraftId) || currentAircraft();
}

function missionPermittedAircraft(mission) {
  const permittedIds = new Set([
    ...(Array.isArray(mission?.permittedAircraftIds) ? mission.permittedAircraftIds : []),
    mission?.verification?.aircraftId
  ].filter(Boolean));
  // Once a mission is accepted, the assigned aircraft may be anywhere along
  // the route. Do not re-filter it by its current airport after takeoff.
  return state.fleet.filter((aircraft) => permittedIds.has(aircraft.id));
}

function telemetryMissionAircraft(sample, mission) {
  return missionPermittedAircraft(mission).find((aircraft) => telemetryMatchesAircraft(sample, aircraft)) || null;
}

function pointFromAirport(airport, distance, bearing) {
  return window.FlightTerrain.pointFromAirport(airport, distance, bearing);
}

function missionRange(category, aircraft = currentAircraft()) {
  const policy = missionPolicies[category] || missionPolicies.客运;
  const aircraftCap = Math.max(45, Math.floor(Number(aircraft?.range || 300) * 0.52));
  return [policy.min, Math.max(policy.min + 8, Math.min(policy.max, aircraftCap))];
}

function isAircraftCompatible(category, aircraft = currentAircraft()) {
  const policy = missionPolicies[category] || missionPolicies.客运;
  const kindAllowed = policy.kinds.includes(aircraft?.kind);
  const capabilityAllowed = category === "客运" ? hasMissionCapability(category, aircraft) : kindAllowed;
  return (kindAllowed || capabilityAllowed) && missionRange(category, aircraft)[1] >= policy.min;
}

function isHelicopterAircraft(aircraft) {
  return ["直升机", "重型直升机"].includes(aircraft?.kind);
}

function isHelicopterEmergencyMission(mission) {
  if (!isEmergencyMission(mission)) return false;
  return (mission.permittedAircraftIds || []).some((id) => isHelicopterAircraft(state.fleet?.find((aircraft) => aircraft.id === id)));
}

function compatibleCategories(aircraft = currentAircraft()) {
  return Object.keys(missionPolicies).filter((category) => isAircraftCompatible(category, aircraft));
}

function dispatchPhase() {
  const hour = new Date().getHours();
  if (hour >= 20 || hour < 5) return "夜间";
  if (hour >= 16) return "傍晚";
  return "日间";
}

function pickBaseRoute(category, aircraft = currentAircraft(), baseOverride = "") {
  const requestedBase = normalizeBaseCode(baseOverride);
  const base = requestedBase && airportByIcao(requestedBase)
    ? requestedBase
    : aircraftOperationalBase(aircraft);
  const baseAirport = airportByIcao(base);
  const [minDistance, maxDistance] = missionRange(category, aircraft);
  const candidates = baseAirport
    ? airportDatabase.map((airport) => ({ ...airport, distance: distanceNm(baseAirport, airport) }))
      .filter((airport) => airport.icao !== base && airport.distance >= minDistance && airport.distance <= maxDistance)
    : [];
  if (candidates.length) {
    const destination = pick(candidates);
    return {
      from: base,
      to: destination.icao,
      route: `${baseAirport.name}基地 · ${destination.name}`,
      distance: destination.distance,
      base,
      baseAirport,
      destination
    };
  }
  // Keep the route anchored to the selected base even when the aircraft or
  // airport database has no candidate in the policy range.
  const fallbackDestination = baseAirport
    ? airportDatabase
      .map((airport) => ({ ...airport, distance: distanceNm(baseAirport, airport) }))
      .filter((airport) => airport.icao !== base)
      .sort((a, b) => a.distance - b.distance)[0]
    : null;
  const fallback = fallbackDestination
    ? { from: base, to: fallbackDestination.icao, route: `${base} 基地周边航段`, distance: fallbackDestination.distance }
    : pickRoute(category);
  return {
    ...fallback,
    from: base,
    base,
    baseAirport,
    distance: fallbackDestination?.distance || fallback.distance || null,
    destination: fallbackDestination || airportByIcao(fallback.to)
  };
}

function makeMission(category, subtype, offsetHours = 0, aircraftOverride = null, baseOverride = "") {
  const aircraft = aircraftOverride || currentAircraft();
  if (!aircraftOverride && !isAircraftCompatible(category, aircraft)) category = compatibleCategories(aircraft)[0] || "包机";
  const scene = buildMissionScene(category, subtype);
  const specialMission = isPackagedScene(scene);
  const airportPair = pickBaseRoute(category, aircraft, baseOverride);
  const [sceneMin, sceneMax] = missionRange(category, aircraft);
  const site = specialMission
    ? window.FlightTerrain.findMissionSite(airportPair.baseAirport, sceneMin, sceneMax, scene.terrain)
    : null;
  if (specialMission && !site) return null;
  const baseMiles = Math.round(specialMission ? site.distanceNm : (airportPair.distance || rand(sceneMin, sceneMax)));
  const cruiseSpeed = specialMission ? rand(105, 165) : rand(180, 260);
  const hours = Math.max(0.6, +(baseMiles / cruiseSpeed).toFixed(1));
  const payoutRate = specialMission ? rand(42, 68) : rand(18, 36);
  // Mission rewards are independent of the pilot's selected airline.
  const payout = Math.round(baseMiles * payoutRate + 500 * rand(2, specialMission ? 7 : 5));
  const repGain = Math.max(2, Math.round(hours * rand(1, 3)));
  const risk = pick(["低", "中", "高"], specialMission ? [0.12, 0.5, 0.38] : [0.48, 0.36, 0.16]);
  const phase = specialMission && category === "医疗" ? "全天候" : dispatchPhase();
  const weather = phase === "夜间" ? pick(["夜航", "侧风", "云底较低"], [0.5, 0.25, 0.25]) : pick(["晴朗", "侧风", "雷雨", "云底较低"], [0.42, 0.24, 0.14, 0.2]);
  const bearing = specialMission ? site.bearing : rand(0, 359);
  const routeTitle = specialMission ? `${airportPair.base} → 航向 ${String(bearing).padStart(3, "0")}°` : `${airportPair.from} → ${airportPair.to}`;
  const routeLabel = specialMission ? `${airportPair.base} 基地周边 ${formatTaskDistanceNm(baseMiles)}` : airportPair.route;
  return {
    id: cryptoId("mission"),
    category,
    subtype,
    title: routeTitle,
    route: routeLabel,
    origin: airportPair.base,
    destination: specialMission ? null : airportPair.to,
    site: specialMission ? { base: airportPair.base, ...site, distanceNm: baseMiles } : null,
    aircraftHint: aircraft.name,
    permittedAircraftIds: [aircraft.id],
    originMode: normalizeBaseCode(baseOverride) ? "pilot-base" : "aircraft-location",
    dispatchPhase: phase,
    recommendedPhases: missionPolicies[category]?.phases || ["日间"],
    distance: baseMiles,
    duration: hours,
    payout,
    repGain,
    risk,
    weather,
    scene,
    summary: `${category}任务 · ${subtype} · ${weather}`,
    status: "open",
    priority: emergencyMissionCategories.includes(category) ? "emergency" : "standard",
    refreshable: true,
    createdAt: Date.now() - offsetHours * 3600 * 1000
  };
}

function refreshMissionFromAircraft(aircraft) {
  if (!aircraft || isCompanyAircraft(aircraft) || !(aircraft.owned || aircraft.rented)) return null;
  const eligibleCategories = compatibleCategories(aircraft);
  if (!eligibleCategories.length) return null;
  const origin = aircraftOperationalBase(aircraft);
  const currentOffers = refreshableMissionOffers();
  const existing = currentOffers.find((mission) => mission.permittedAircraftIds?.includes(aircraft.id)
    && normalizeBaseCode(mission.origin) === normalizeBaseCode(origin));
  if (existing) return existing;
  if (currentOffers.length >= MISSION_OFFER_TARGET_COUNT) {
    const replaceable = currentOffers
      .filter((mission) => !isEmergencyMission(mission))
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0];
    if (replaceable) state.missions = state.missions.filter((mission) => mission.id !== replaceable.id);
  }
  const category = randomCategory(eligibleCategories);
  const mission = makeMission(category, randomSubtype(category), 0, aircraft);
  if (!mission) return null;
  mission.permittedAircraftIds = [aircraft.id];
  mission.aircraftHint = aircraft.name;
  state.missions.unshift(mission);
  return mission;
}

function pickRoute(category) {
  const routePools = {
    客运: [
      { from: "ZBAA", to: "ZSPD", route: "华北干线" },
      { from: "ZGGG", to: "ZPPP", route: "南方走廊" },
      { from: "RJTT", to: "RJCC", route: "东亚航段" },
      { from: "EGLL", to: "LFPG", route: "欧洲短干线" }
    ],
    货运: [
      { from: "ZSPD", to: "ZUCK", route: "华东物流" },
      { from: "KDFW", to: "KORD", route: "北美货运" },
      { from: "EDDF", to: "EHAM", route: "欧洲快件" }
    ],
    包机: [
      { from: "ZSSS", to: "ZWSH", route: "商务包机" },
      { from: "KLAX", to: "KLAS", route: "VIP往返" },
      { from: "RJBB", to: "ROAH", route: "观光飞行" }
    ],
    医疗: [
      { from: "ZPPP", to: "ZUNZ", route: "医疗转运" },
      { from: "KDEN", to: "KSLC", route: "紧急航段" },
      { from: "EHAM", to: "EBBR", route: "急救支援" }
    ],
    搜救: [
      { from: "ZUUU", to: "ZUXC", route: "川西山区搜救" },
      { from: "KDEN", to: "KASE", route: "落基山地搜救" },
      { from: "PAJN", to: "PAGS", route: "冰川搜索区" }
    ],
    海上救援: [
      { from: "VHHH", to: "VMMC", route: "珠江口救援区" },
      { from: "RJTT", to: "RJBB", route: "太平洋沿岸搜救" },
      { from: "PHNL", to: "PHOG", route: "夏威夷岛链救援" }
    ],
    事故调查: [
      { from: "ZBAA", to: "ZBSJ", route: "华北调查航段" },
      { from: "EGLL", to: "EGKK", route: "事故调查运输" },
      { from: "KLAX", to: "KPSP", route: "现场勘察航段" }
    ]
  };
  return pick(routePools[category] || routePools.客运);
}

function chooseMissionAircraft(category) { return currentAircraft().name; }

function pick(list, weights) {
  if (!weights) {
    return list[Math.floor(Math.random() * list.length)];
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return list[i];
  }
  return list[list.length - 1];
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatMoney(value) {
  const amount = Number(value);
  return `$${(Number.isFinite(amount) ? amount : 0).toLocaleString("en-US")}`;
}

function formatCompactMoney(value) {
  const amount = Number(value) || 0;
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  // Keep high-value balances within the narrow profile card. In the UI,
  // one billion is intentionally shown as 1B (10 亿), followed by T for
  // trillion-scale values.
  if (absolute >= 1_000_000_000_000) return `$${sign}${trimCompactDecimal(absolute / 1_000_000_000_000)}T`;
  if (absolute >= 1_000_000_000) return `$${sign}${trimCompactDecimal(absolute / 1_000_000_000)}B`;
  if (absolute >= 10000) return `$${sign}${trimCompactDecimal(absolute / 10000)}W`;
  if (absolute >= 1000) return `$${sign}${trimCompactDecimal(absolute / 1000)}K`;
  return formatMoney(amount);
}

function trimCompactDecimal(value) {
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatHours(value) {
  const hours = Number(value);
  return `${(Number.isFinite(hours) ? hours : 0).toFixed(1)} 小时`;
}

function formatFuel(value) {
  if (value === null || value === undefined || value === "") return "暂无数据";
  const fuel = Number(value);
  return Number.isFinite(fuel) ? `${fuel.toFixed(1)} kg` : "暂无数据";
}

function formatDistanceNm(value) {
  const distance = Number(value);
  return Number.isFinite(distance)
    ? `${distance.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} nm`
    : "暂无数据";
}

function formatTaskDistanceNm(value) {
  const distance = Number(value);
  return Number.isFinite(distance)
    ? `${Math.max(0, Math.round(distance)).toLocaleString("zh-CN")} nm`
    : "0 nm";
}

function formatTaskRouteLabel(value) {
  return String(value || "").replace(/(\d+(?:\.\d+)?)\s*nm\b/gi, (_, distance) => formatTaskDistanceNm(distance));
}

function formatFuelTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "尚未从 MSFS 同步";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (elapsedMinutes < 1) return "刚刚从 MSFS 同步";
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前同步`;
  return new Date(timestamp).toLocaleString("zh-CN");
}

function aircraftCondition(aircraft) {
  return Math.max(0, Math.min(100, Number(aircraft?.conditionPercent ?? 100) || 0));
}

function aircraftMaintenanceCost(aircraft) {
  const missingCondition = 100 - aircraftCondition(aircraft);
  if (missingCondition < 0.05) return 0;
  const referenceValue = Math.max(50_000, Number(aircraft?.price) || Number(aircraft?.rent || 0) * 100);
  return Math.max(50, Math.round(missingCondition * referenceValue * 0.00002));
}

function aircraftConditionLevel(aircraft) {
  const condition = aircraftCondition(aircraft);
  if (condition < 40) return { className: "is-critical", label: "严重损坏" };
  if (condition < 75) return { className: "is-damaged", label: "需要维修" };
  if (condition < 95) return { className: "is-worn", label: "轻度磨损" };
  return { className: "is-good", label: "状态良好" };
}

function landingWearPercent(landing) {
  const verticalSpeed = Math.abs(Number(landing?.landingRateFpm));
  if (!Number.isFinite(verticalSpeed) || verticalSpeed <= 0) return 0;
  if (verticalSpeed > 650) return Math.min(35, 18 + Math.round((verticalSpeed - 650) / 100));
  if (verticalSpeed > 450) return 10;
  if (verticalSpeed > 250) return 5;
  if (verticalSpeed > 120) return 2;
  return 1;
}

function applyLandingWear(aircraft, landing, startedAt = 0) {
  const reportTimestamp = Date.parse(landing?.timestamp || "");
  const previousReportAt = Number(aircraft?.lastLandingReportAt) || 0;
  if (!aircraft || !Number.isFinite(reportTimestamp) || reportTimestamp <= Number(startedAt || 0) || reportTimestamp <= previousReportAt) return null;
  const wearPercent = landingWearPercent(landing);
  const peakG = Number.isFinite(Number(landing?.peakG)) ? +Number(landing.peakG).toFixed(2) : null;
  if (wearPercent <= 0 && !(peakG > 3)) return null;
  const previousCondition = aircraftCondition(aircraft);
  aircraft.conditionPercent = +Math.max(0, previousCondition - wearPercent).toFixed(1);
  aircraft.lastLandingReportAt = reportTimestamp;
  aircraft.lastLandingRateFpm = Math.abs(Math.round(Number(landing.landingRateFpm)));
  aircraft.lastLandingPeakG = peakG;
  aircraft.lastLandingWearPercent = wearPercent;
  aircraft.lastLandingAirport = String(landing.airport || "");
  aircraft.lastLandingRunway = String(landing.runway || "");
  return {
    aircraft,
    previousCondition,
    conditionPercent: aircraft.conditionPercent,
    wearPercent,
    landingRateFpm: aircraft.lastLandingRateFpm,
    peakG: aircraft.lastLandingPeakG
  };
}

function isCrashLanding(landingOrWear) {
  return Number(landingOrWear?.peakG ?? landingOrWear?.landingPeakG) > 3;
}

function syncFleetLandingWear(landing) {
  if (!landing) return null;
  const aircraft = state.fleet.find((item) => (item.owned || item.rented) && telemetryMatchesAircraft(landing, item));
  if (!aircraft) return null;
  return applyLandingWear(aircraft, landing, state.features?.landingWearStartedAt);
}

function telemetryEventTime(value, fallback = Date.now()) {
  const parsed = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function landingReportMatchesTouchdown(landing, sample, aircraft, departedAt = 0, maximumAgeMs = 10 * 60_000, expectedAirport = "") {
  if (!landing || !sample || !aircraft || !telemetryBoolean(sample.onGround)) return false;
  const reportAt = telemetryEventTime(landing.timestamp ?? landing.Timestamp, Number.NaN);
  const sampleAt = telemetryEventTime(sample.timestamp ?? sample.Timestamp, Number.NaN);
  if (!Number.isFinite(reportAt) || !Number.isFinite(sampleAt)) return false;
  if (Number(departedAt) > 0 && reportAt < Number(departedAt) - 1000) return false;
  if (reportAt > sampleAt + 5000 || sampleAt - reportAt > maximumAgeMs) return false;
  const expectedAirportCode = String(expectedAirport || "").trim().toUpperCase();
  const reportAirportCode = String(landing.airport ?? landing.Airport ?? landing.runwayAirport ?? landing.RunwayAirport ?? "").trim().toUpperCase();
  // A few aircraft do not expose a runway identity to the detector. In that
  // case the live sample's airport plus the touchdown coordinates still bind
  // the report to the mission airport; a non-empty conflicting report code is
  // always rejected.
  const sampleAirportCode = String(sample.runwayAirport ?? sample.RunwayAirport ?? "").trim().toUpperCase();
  if (expectedAirportCode && reportAirportCode && reportAirportCode !== expectedAirportCode) return false;
  if (expectedAirportCode && !reportAirportCode && sampleAirportCode && sampleAirportCode !== expectedAirportCode) return false;
  if (!telemetryMatchesAircraft(landing, aircraft)) return false;
  const landingPoint = {
    lat: Number(landing.touchdownLatitude ?? landing.TouchdownLatitude),
    lon: Number(landing.touchdownLongitude ?? landing.TouchdownLongitude)
  };
  const samplePoint = { lat: Number(sample.latitude), lon: Number(sample.longitude) };
  if (Object.values(landingPoint).every(Number.isFinite)
    && Object.values(samplePoint).every(Number.isFinite)
    && distanceNm(landingPoint, samplePoint) > 2) return false;
  return true;
}

function landingReportActual(landing, aircraft) {
  if (!landing) return {};
  const reportAt = Date.parse(landing.timestamp || "");
  const landingRateFpm = Math.abs(Number(landing.landingRateFpm));
  const landingPeakG = Number(landing.peakG);
  const appliedToAircraft = Number(aircraft?.lastLandingReportAt) === reportAt;
  return {
    landingRateFpm: Number.isFinite(landingRateFpm) ? landingRateFpm : null,
    landingPeakG: Number.isFinite(landingPeakG) ? landingPeakG : null,
    landingWearPercent: appliedToAircraft
      ? Number(aircraft.lastLandingWearPercent || 0)
      : landingWearPercent(landing),
    landingAirport: String(landing.airport || ""),
    landingRunway: String(landing.runway || ""),
    landingReportAt: Number.isFinite(reportAt) ? reportAt : null
  };
}

function simulatorFlightMission(aircraft) {
  const mission = activeVerifiedMission();
  return mission?.verification?.aircraftId === aircraft?.id ? mission : null;
}

function handleAircraftCrash(landingWear, landing, sample) {
  const aircraft = landingWear?.aircraft;
  if (!aircraft || !isCrashLanding(landingWear)) return null;
  const flight = normalizeSimulatorFlight(state.simulatorFlight);
  const reportAt = telemetryEventTime(landing?.timestamp);
  const arrival = normalizeBaseCode(landing?.airport || telemetryAirport(sample)?.airport?.icao || flight.lastGroundAirport);
  const departure = normalizeBaseCode(flight.origin || flight.lastGroundAirport);
  const mission = state.missions.find((item) => item.id === flight.missionId && item.status === "accepted");
  const missionSop = mission?.verification?.sop || {};
  const sopSnapshot = buildLandingSopSnapshot(mission, landingWear, landing, aircraft, reportAt, arrival);
  const { sopEnabled, sopScore, sopMultiplier, sopDeductions, sopReport } = sopSnapshot;
  const crashLog = {
    id: cryptoId("crash-log"),
    source: "msfs",
    status: "crashed",
    missionId: flight.missionId,
    taskTitle: state.missions.find((mission) => mission.id === flight.missionId)?.title || "",
    date: reportAt,
    from: departure || "未知起飞点",
    to: arrival || "未知落地点",
    departureAirport: departure,
    arrivalAirport: arrival,
    aircraftId: aircraft.id,
    aircraftName: aircraft.name,
    hours: 0,
    miles: +Math.max(0, Number(flight.distanceNm) || 0).toFixed(1),
    income: 0,
    grossIncome: 0,
    landingRateFpm: landingWear.landingRateFpm,
    landingPeakG: landingWear.peakG,
    landingAirport: arrival,
    landingRunway: String(landing?.runway || ""),
    landingWearPercent: landingWear.wearPercent,
    landingReportAt: reportAt,
    sopEnabled,
    sopScore,
    sopMultiplier,
    sopDeductions,
    sopReport,
    crashReason: `接地峰值 ${Number(landingWear.peakG).toFixed(2)}G，超过 3G 安全上限`,
    notes: `坠机记录：${departure || "未知起飞点"} → ${arrival || "未知落地点"}。飞机已从机库移除。`
  };
  state.logs.unshift(crashLog);
  const companyTask = state.company?.tasks?.find((task) => task.aircraftId === aircraft.id && task.status === "assigned");
  if (companyTask) {
    companyTask.status = "crashed";
    companyTask.completedAt = reportAt;
    companyTask.departureAirport = departure;
    companyTask.arrivalAirport = arrival;
    companyTask.airportCheck = "failed";
    updateCompanyFlightLog(companyTask, {
      status: "crashed",
      completedAt: reportAt,
      departureAirport: departure,
      arrivalAirport: arrival,
      airportCheck: "failed",
      landingRateFpm: landingWear.landingRateFpm,
      landingPeakG: landingWear.peakG,
      crashReason: crashLog.crashReason
    });
    const pilot = state.company.pilots.find((item) => item.id === companyTask.pilotId);
    if (pilot) pilot.assignedTaskId = "";
  }
  if (mission) {
    mission.status = "failed";
    mission.completedAt = reportAt;
    mission.verification = {
      ...(mission.verification || {}),
      phase: "crashed",
      phaseLabel: "坠机，任务失败",
      detail: `${crashLog.crashReason}${sopEnabled ? `，SOP 得分 ${Math.round(sopScore)}/100` : ""}`,
      arrivalAirport: arrival,
      sop: {
        ...missionSop,
        enabled: sopEnabled,
        score: sopScore,
        multiplier: sopMultiplier,
        report: sopReport,
        settledAt: reportAt
      }
    };
    recordTaskEvent(mission, { key: "crashed", title: "飞机坠机，任务失败", detail: crashLog.crashReason, phase: "crashed" });
  }
  state.fleet = state.fleet.filter((item) => item.id !== aircraft.id);
  if (Array.isArray(state.company?.aircraftIds)) state.company.aircraftIds = state.company.aircraftIds.filter((id) => id !== aircraft.id);
  if (!state.fleet.some((item) => item.selected && !isCompanyAircraft(item))) {
    const fallback = state.fleet.find((item) => !isCompanyAircraft(item) && (item.owned || item.rented));
    if (fallback) state.fleet.forEach((item) => { item.selected = item.id === fallback.id; });
  }
  state.simulatorFlight = emptySimulatorFlight(arrival, flight.lastFuelKg);
  return crashLog;
}

function updateSimulatorFlight(sample, aircraft, now = Date.now()) {
  if (!sample || !aircraft) return false;
  const eventAt = telemetryEventTime(sample.timestamp, now);
  const onGround = telemetryBoolean(sample.onGround);
  const point = Number.isFinite(Number(sample.latitude)) && Number.isFinite(Number(sample.longitude))
    ? { lat: Number(sample.latitude), lon: Number(sample.longitude) }
    : null;
  const airportCode = telemetryAirport(sample)?.airport?.icao || "";
  const fuelKg = telemetryFuelKg(sample);
  let flight = normalizeSimulatorFlight(state.simulatorFlight);

  if (flight.active && flight.aircraftId !== aircraft.id) {
    if (onGround) state.simulatorFlight = emptySimulatorFlight(airportCode, fuelKg);
    return false;
  }

  if (!flight.active) {
    if (onGround) {
      flight.lastGroundAirport = airportCode || flight.lastGroundAirport;
      if (fuelKg !== null) flight.lastGroundFuelKg = fuelKg;
      flight.lastSampleAt = eventAt;
      state.simulatorFlight = flight;
      return true;
    }
    const mission = simulatorFlightMission(aircraft);
    const startFuelKg = flight.lastGroundFuelKg ?? fuelKg;
    flight = {
      ...emptySimulatorFlight(flight.lastGroundAirport, flight.lastGroundFuelKg),
      active: true,
      aircraftId: aircraft.id,
      aircraftName: aircraft.name,
      missionId: mission?.id || "",
      departedAt: eventAt,
      origin: flight.lastGroundAirport || mission?.verification?.departureAirport || mission?.origin || "未知起飞点",
      fuelStartKg: startFuelKg,
      lastFuelKg: fuelKg,
      lastPoint: point,
      lastSampleAt: eventAt
    };
    state.simulatorFlight = flight;
    return true;
  }

  if (flight.lastPoint && point) {
    const elapsedSec = (eventAt - Number(flight.lastSampleAt || eventAt)) / 1000;
    const step = distanceNm(flight.lastPoint, point);
    const speedKt = Math.max(
      Number(sample.groundSpeedKt) || 0,
      Number(sample.indicatedAirspeedKt) || 0,
      Number(sample.trueAirspeedKt) || 0
    );
    const plausibleStep = Math.max(2, speedKt * Math.max(1, Math.min(elapsedSec, 60)) / 3600 * 4);
    if (!telemetryBoolean(sample.slewActive) && elapsedSec > 0 && elapsedSec <= 120 && step <= 20 && step <= plausibleStep) {
      flight.distanceNm = accumulateFlightDistance(flight.distanceNm, step);
    }
  }

  if (fuelKg !== null) {
    const previousFuelKg = Number(flight.lastFuelKg);
    if (Number.isFinite(previousFuelKg)) {
      const change = previousFuelKg - fuelKg;
      const plausibleDrop = Math.max(50, previousFuelKg * 0.25);
      if (change > 0 && change <= plausibleDrop) {
        flight.fuelUsedKg = +(flight.fuelUsedKg + change).toFixed(2);
      } else if (change < 0) {
        flight.fuelAddedKg = +(flight.fuelAddedKg + Math.abs(change)).toFixed(2);
      }
    }
    flight.lastFuelKg = fuelKg;
  }
  if (onGround) {
    flight.lastGroundAirport = airportCode || flight.lastGroundAirport;
    if (fuelKg !== null) flight.lastGroundFuelKg = fuelKg;
  }
  flight.lastPoint = point || flight.lastPoint;
  flight.lastSampleAt = eventAt;
  state.simulatorFlight = flight;
  return true;
}

function finalizeSimulatorFlight(landingWear, landing, sample, now = Date.now()) {
  const flight = normalizeSimulatorFlight(state.simulatorFlight);
  if (!flight.active || !landingWear?.aircraft || flight.aircraftId !== landingWear.aircraft.id) return null;
  const mission = state.missions.find((item) => item.id === flight.missionId) || null;
  const reportAt = telemetryEventTime(landing?.timestamp, now);
  const nearbyAirport = telemetryAirport(sample)?.airport?.icao || "";
  const missionArrival = mission?.verification?.phase === "returning"
    ? mission.origin
    : mission?.destination || mission?.site?.name || "任务现场";
  const arrival = String(landing?.airport || nearbyAirport || flight.lastGroundAirport || (mission ? missionArrival : "未知落地点")).toUpperCase();
  const fuelUsedKg = +Math.max(0, Number(flight.fuelUsedKg) || 0).toFixed(2);
  const fuelCost = Math.round(fuelUsedKg * FUEL_PRICE_PER_KG);
  const elapsedHours = (reportAt - Number(flight.departedAt || reportAt)) / 3600000;
  const hours = +Math.max(0.01, Number.isFinite(elapsedHours) ? elapsedHours : 0).toFixed(2);
  const miles = +Math.max(0, Number(flight.distanceNm) || 0).toFixed(1);
  const runway = String(landing?.runway || "").trim();
  const sopSnapshot = buildLandingSopSnapshot(mission, landingWear, landing, landingWear.aircraft, reportAt, arrival);
  const log = {
    id: cryptoId("log"),
    source: "msfs",
    missionId: flight.missionId,
    taskTitle: mission?.title || "",
    date: reportAt,
    from: flight.origin || "未知起飞点",
    to: arrival,
    departureAirport: String(flight.origin || "").toUpperCase(),
    arrivalAirport: arrival,
    airportCheck: mission
      ? (String(flight.origin || "").trim().toUpperCase() === String(mission.origin || "").trim().toUpperCase()
        && String(arrival || "").trim().toUpperCase() === String(mission.destination || mission.origin || "").trim().toUpperCase() ? "passed" : "failed")
      : "pending",
    aircraftId: flight.aircraftId,
    aircraftName: flight.aircraftName || landingWear.aircraft.name,
    hours,
    miles,
    income: 0,
    grossIncome: 0,
    fuelStartKg: flight.fuelStartKg,
    fuelEndKg: flight.lastFuelKg,
    fuelUsedKg,
    fuelCost,
    landingRateFpm: landingWear.landingRateFpm,
    landingPeakG: landingWear.peakG,
    landingWearPercent: landingWear.wearPercent,
    landingAirport: arrival,
    landingRunway: runway,
    landingReportAt: reportAt,
    ...sopSnapshot,
    notes: `MSFS 实际飞行：${flight.origin || "未知起飞点"} → ${arrival}${runway ? ` 跑道 ${runway}` : ""}，接地率 ${landingWear.landingRateFpm} fpm。`
  };
  state.logs.unshift(log);
  const companyTask = state.company?.tasks?.find((task) => task.aircraftId === flight.aircraftId && task.status === "assigned");
  if (companyTask) {
    const departureMatches = normalizeBaseCode(flight.origin) === normalizeBaseCode(companyTask.origin);
    const arrivalMatches = normalizeBaseCode(arrival) === normalizeBaseCode(companyTask.destination);
    companyTask.departureAirport = normalizeBaseCode(flight.origin);
    companyTask.arrivalAirport = arrival;
    companyTask.airportCheck = departureMatches && arrivalMatches ? "passed" : "failed";
    companyTask.status = "completed";
    companyTask.completedAt = reportAt;
    updateCompanyFlightLog(companyTask, {
      status: companyTask.airportCheck === "passed" ? "completed" : "airport-mismatch",
      completedAt: reportAt,
      departureAirport: companyTask.departureAirport,
      arrivalAirport: arrival,
      airportCheck: companyTask.airportCheck,
      landingRateFpm: landingWear.landingRateFpm,
      landingPeakG: landingWear.peakG
    });
    const companyAircraft = state.fleet.find((item) => item.id === companyTask.aircraftId);
    if (companyAircraft && arrival) companyAircraft.lastLandingAirport = arrival;
    if (typeof refreshCompanyMissionFromAircraft === "function") refreshCompanyMissionFromAircraft(companyAircraft);
    const pilot = state.company.pilots.find((item) => item.id === companyTask.pilotId);
    if (pilot) pilot.assignedTaskId = "";
  }
  state.stats.totalHours = +(Number(state.stats.totalHours || 0) + hours).toFixed(2);
  state.stats.totalMiles = +(Number(state.stats.totalMiles || 0) + miles).toFixed(1);
  state.stats.totalLandings = Number(state.stats.totalLandings || 0) + 1;
  state.stats.totalFuelKg = +(Number(state.stats.totalFuelKg || 0) + fuelUsedKg).toFixed(2);
  state.stats.totalFuelCost = +(Number(state.stats.totalFuelCost || 0) + fuelCost).toFixed(2);
  state.simulatorFlight = emptySimulatorFlight(arrival, flight.lastFuelKg);
  return log;
}

function aircraftHasActiveMission(aircraft) {
  return state.missions.some((mission) => mission.status === "accepted"
    && mission.verification?.aircraftId === aircraft?.id);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "FL";
}

function isAvatarDataUrl(value) {
  return typeof value === "string" && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value);
}

function getAvatarPreset(id) {
  return AVATAR_PRESETS.find((avatar) => avatar.id === id) || null;
}

function activeAvatarSource(pilot = state.pilot) {
  const preset = getAvatarPreset(pilot?.avatarPreset);
  if (preset) return preset.src;
  return isAvatarDataUrl(pilot?.avatarDataUrl) ? pilot.avatarDataUrl : "";
}

function renderAvatar(element, dataUrl, name, presetId = "") {
  if (!element) return;
  element.replaceChildren();
  const preset = getAvatarPreset(presetId);
  const source = preset?.src || (isAvatarDataUrl(dataUrl) ? dataUrl : "");
  if (source) {
    const image = document.createElement("img");
    image.src = source;
    image.alt = `${name || "飞行员"}头像`;
    element.append(image);
  } else {
    element.textContent = initials(name || "");
  }
}

function renderAvatarChoices() {
  if (!els.avatarChoiceGrid) return;
  const customAvatar = isAvatarDataUrl(state.pilot.avatarDataUrl)
    ? { id: "custom", label: "我的上传", src: state.pilot.avatarDataUrl }
    : null;
  const choices = customAvatar ? [...AVATAR_PRESETS, customAvatar] : AVATAR_PRESETS;
  const selectedId = getAvatarPreset(state.pilot.avatarPreset)?.id || (customAvatar ? "custom" : "");
  els.avatarChoiceGrid.innerHTML = choices.map((avatar) => `
    <button class="avatar-choice${selectedId === avatar.id ? " is-selected" : ""}" type="button" data-avatar-choice="${avatar.id}" aria-label="选择${avatar.label}" title="${avatar.label}">
      <img src="${avatar.src}" alt="${avatar.label}">
      <span class="avatar-choice-label">${avatar.label}</span>
    </button>`).join("");
  if (els.avatarChoiceStatus) {
    els.avatarChoiceStatus.textContent = selectedId === "custom"
      ? "我的上传"
      : getAvatarPreset(selectedId)?.label || "默认头像";
  }
}

function selectAvatar(choiceId) {
  if (choiceId === "custom") {
    if (!isAvatarDataUrl(state.pilot.avatarDataUrl)) {
      toast("请先上传头像");
      return;
    }
    state.pilot.avatarPreset = "";
  } else if (getAvatarPreset(choiceId)) {
    state.pilot.avatarPreset = choiceId;
  } else {
    return;
  }
  renderAvatar(els.pilotAvatarPreview, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
  renderAvatar(els.pilotInitials, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
  renderAvatarChoices();
  saveState();
  toast(choiceId === "custom" ? "已选择我的上传头像" : "头像已更新");
}

function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(?:png|jpe?g|webp)$/i.test(file.type)) {
      reject(new Error("unsupported-avatar-type"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("avatar-too-large"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("avatar-read-failed"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("avatar-decode-failed"));
      image.onload = () => {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("avatar-canvas-failed"));
          return;
        }
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function showView(view) {
  state.activeView = view;
  document.body.classList.toggle("map-view-active", view === "map");
  Object.entries(els.views).forEach(([key, node]) => node.classList.toggle("is-active", key === view));
  els.viewButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  if (view === "map") renderMapPage();
  if (view === "monitor") updateMonitor(lastSimulatorPayload);
  if (view === "sop") renderSopMonitor();
  saveState();
}

function monitorText(value, fallback = "--") {
  return value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value)) ? fallback : String(value);
}

function monitorNumber(value, suffix = "", digits = 0) {
  if (value === null || value === undefined || value === "") return `--${suffix}`;
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("zh-CN", { maximumFractionDigits: digits })}${suffix}` : `--${suffix}`;
}

function monitorBoolean(value, onText = "开启", offText = "关闭") {
  if (value === null || value === undefined || value === "") return { text: "无数据", className: "is-unknown", checked: false };
  const active = telemetryBoolean(value);
  return { text: active ? onText : offText, className: active ? "is-on" : "is-off", checked: active };
}

function monitorEquipmentState(key, value) {
  if (key === "parkingBrake") return monitorBoolean(value, "已设置", "未设置");
  if (!["flapsPercent", "spoilersPercent", "gearPercent"].includes(key)) return monitorBoolean(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
    return { text: "无数据", className: "is-unknown", checked: false, stateKey: "unknown" };
  }
  const percent = Math.max(0, Math.min(100, Number(value)));
  if (key === "gearPercent") {
    if (percent >= 95) return { text: "已放下", className: "is-on", checked: true, stateKey: "on" };
    if (percent <= 5) return { text: "已收起", className: "is-off", checked: false, stateKey: "off" };
    return { text: `转换中 ${Math.round(percent)}%`, className: "is-transition", checked: false, stateKey: "transition" };
  }
  const active = percent > 0.5;
  const text = key === "flapsPercent"
    ? (active ? `放出 ${Math.round(percent)}%` : "已收起")
    : (active ? `展开 ${Math.round(percent)}%` : "已收起");
  return { text, className: active ? "is-on" : "is-off", checked: active, stateKey: active ? "on" : "off" };
}

function updateMonitor(payload = {}) {
  if (!els.monitorConnection) return;
  const connected = payload.connected === true && payload.sample;
  const stateKey = connected ? "connected" : payload.bridgeError || payload.bridgeExit ? "error" : payload.bridgeRunning ? "waiting" : "offline";
  if (stateKey !== lastMonitorConnectionState) {
    if (lastMonitorConnectionState && stateKey !== "connected") void reportRuntimeLog("warn", `实时监测状态：${stateKey}`);
    if (stateKey === "connected") void reportRuntimeLog("info", "实时监测已接收 MSFS 遥测");
    lastMonitorConnectionState = stateKey;
  }
  els.monitorConnection.className = `monitor-connection-band ${connected ? "is-live" : stateKey === "error" ? "is-error" : "is-offline"}`;
  els.monitorConnectionTitle.textContent = connected ? "MSFS 已连接" : stateKey === "error" ? "MSFS 连接异常" : payload.bridgeRunning ? "等待 MSFS" : "等待 MSFS 连接";
  els.monitorConnectionDetail.textContent = connected
    ? `${payload.sample.aircraftTitle || payload.sample.aircraftModel || "未知机型"} · ${payload.sample.aircraftTypeCode || ""}`
    : payload.bridgeError?.message || payload.bridgeExit?.message || "遥测服务正在自动检测模拟器";
  els.monitorUpdatedAt.textContent = connected ? `更新于 ${new Date().toLocaleTimeString("zh-CN")}` : "尚无实时数据";

  const sample = connected ? payload.sample : null;
  const values = {
    aircraftTitle: sample ? `${sample.aircraftTitle || sample.aircraftModel || "未知机型"} · ${sample.loadedAircraftName || ""}`.replace(/ · $/, "") : "等待飞机数据",
    callsign: sample?.callsign,
    indicatedAirspeedKt: monitorNumber(sample?.indicatedAirspeedKt, " kt"),
    trueAirspeedKt: monitorNumber(sample?.trueAirspeedKt, " kt"),
    groundSpeedKt: monitorNumber(sample?.groundSpeedKt, " kt"),
    verticalSpeedFpm: monitorNumber(sample?.verticalSpeedFpm, " fpm"),
    altitudeFt: monitorNumber(sample?.altitudeFt, " ft"),
    radioAltitudeFt: monitorNumber(sample?.radioAltitudeFt, " ft"),
    magneticHeadingDeg: monitorNumber(sample?.magneticHeadingDeg ?? sample?.headingDeg, "°"),
    attitude: sample ? `${monitorNumber(sample.pitchDeg, "°", 1)} / ${monitorNumber(sample.bankDeg, "°", 1)}` : "--° / --°",
    gForce: monitorNumber(sample?.gForce, " G", 2),
    fuel: sample ? `${formatFuel(telemetryFuelKg(sample))} / ${formatFuel(telemetryFuelCapacityKg(sample))}` : "--",
    parkingBrake: sample ? (monitorBoolean(sample.parkingBrake).text) : "--",
    simulationRate: sample ? `${monitorNumber(sample.simulationRate, "x", 1)}${sample.slewActive ? " · SLEW" : ""}` : "--",
    position: sample ? `${monitorNumber(sample.latitude, "°", 4)}, ${monitorNumber(sample.longitude, "°", 4)}` : "--",
    engineRunning: sample ? (monitorBoolean(sample.engineRunning).text) : "--",
    flightPhase: connected ? (sample.onGround ? "地面" : "飞行中") : "未连接"
  };
  document.querySelectorAll("[data-monitor-field]").forEach((node) => {
    node.textContent = monitorText(values[node.dataset.monitorField]);
  });
  const monitorControlKeys = ["navigationLights", "antiCollisionLights", "taxiLights", "landingLights", "strobeLights", "parkingBrake", "flapsPercent", "spoilersPercent", "gearPercent"];
  monitorControlKeys.forEach((key) => {
    const value = key === "antiCollisionLights"
      ? sample?.antiCollisionLights ?? sample?.beaconLights
      : sample?.[key];
    const state = monitorEquipmentState(key, value);
    const input = document.querySelector(`[data-monitor-light="${key}"]`);
    const status = document.querySelector(`[data-monitor-light-state="${key}"]`);
    if (input) {
      input.checked = state.checked;
      input.dataset.monitorState = state.stateKey || (state.checked ? "on" : state.className === "is-unknown" ? "unknown" : "off");
      input.setAttribute("aria-checked", String(state.checked));
    }
    if (status) {
      status.className = `monitor-light-state ${state.className}`;
      status.querySelector("b").textContent = state.text;
    }
  });
}

async function reportRuntimeLog(level, message, context = {}) {
  const text = String(message || "").trim().slice(0, 500);
  const signature = `${level}:${text}:${JSON.stringify(context)}`;
  if (!text || runtimeLogRequestPromise || (signature === lastRuntimeLogSignature && Date.now() - lastRuntimeLogAt < 30_000)) return;
  lastRuntimeLogSignature = signature;
  lastRuntimeLogAt = Date.now();
  runtimeLogRequestPromise = fetch("/api/runtime-log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ level: ["info", "warn", "error"].includes(level) ? level : "info", message: text, context })
  }).catch(() => {}).finally(() => { runtimeLogRequestPromise = null; });
  await runtimeLogRequestPromise;
}

function renderRuntimeLogs(logs = []) {
  if (!els.runtimeLogList) return;
  els.runtimeLogStatus.textContent = `${logs.length} 条 · ${new Date().toLocaleTimeString("zh-CN")}`;
  els.runtimeLogList.innerHTML = logs.length ? logs.map((entry) => `
    <div class="runtime-log-entry is-${escapeHtml(entry.level || "info")}">
      <span class="runtime-log-dot"></span>
      <time>${escapeHtml(new Date(entry.at || Date.now()).toLocaleString("zh-CN"))}</time>
      <strong>${escapeHtml(entry.level === "error" ? "错误" : entry.level === "warn" ? "警告" : "信息")}</strong>
      <p>${escapeHtml(entry.message || "无消息")}${entry.context && Object.keys(entry.context).length ? `<small>${escapeHtml(Object.entries(entry.context).map(([key, value]) => `${key}: ${value}`).join(" · "))}</small>` : ""}</p>
    </div>`).join("") : `<p class="runtime-log-empty">暂无运行日志。</p>`;
}

async function loadRuntimeLogs() {
  if (!els.runtimeLogList) return;
  els.runtimeLogStatus.textContent = "正在读取";
  try {
    const response = await fetch("/api/runtime-log", { cache: "no-store" });
    if (!response.ok) throw new Error(`runtime log ${response.status}`);
    renderRuntimeLogs((await response.json()).logs || []);
  } catch (error) {
    els.runtimeLogStatus.textContent = "读取失败";
    els.runtimeLogList.innerHTML = `<p class="runtime-log-empty">运行日志服务不可用。</p>`;
    void reportRuntimeLog("error", "读取运行日志失败", { error: error.message });
  }
}

async function clearRuntimeLogs() {
  if (!await showConfirmDialog("确定清空运行日志吗？清空后无法恢复。")) return;
  try {
    const response = await fetch("/api/runtime-log", { method: "DELETE" });
    if (!response.ok) throw new Error(`runtime log ${response.status}`);
    renderRuntimeLogs([]);
    toast("运行日志已清空");
  } catch { toast("运行日志清空失败"); }
}

async function exportRuntimeLogs() {
  try {
    const response = await fetch("/api/runtime-log", { cache: "no-store" });
    if (!response.ok) throw new Error("runtime log unavailable");
    const payload = await response.json();
    const blob = new Blob([JSON.stringify(payload.logs || [], null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `mofei-runtime-log-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("运行日志已导出");
  } catch { toast("运行日志导出失败"); }
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
}

function showConfirmDialog(message) {
  if (!els.confirmModal || !els.confirmMessage) return Promise.resolve(false);
  els.confirmMessage.textContent = message;
  els.confirmModal.showModal();
  return new Promise((resolve) => {
    const handleClose = () => {
      els.confirmModal.removeEventListener("close", handleClose);
      resolve(els.confirmModal.returnValue === "confirm");
    };
    els.confirmModal.addEventListener("close", handleClose, { once: true });
  });
}

async function speakNext() {
  if (speechPlaying || !speechQueue.length) return;
  speechPlaying = true;
  const text = speechQueue.shift();
  let audioUrl = "";
  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice: preferredVoiceName })
    });
    if (!response.ok) throw new Error(`speech service ${response.status}`);
    audioUrl = URL.createObjectURL(await response.blob());
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    audio.volume = normalizeSpeechVolume(state.settings?.speechVolume);
    await new Promise((resolve, reject) => {
      audio.addEventListener("canplaythrough", resolve, { once: true });
      audio.addEventListener("error", () => reject(new Error("audio decode failed")), { once: true });
      audio.load();
    });
    await audio.play();
    await new Promise((resolve) => {
      audio.addEventListener("ended", resolve, { once: true });
      audio.addEventListener("error", resolve, { once: true });
    });
    speechServiceErrorNotified = false;
  } catch {
    if (!speechServiceErrorNotified) {
      speechServiceErrorNotified = true;
      toast(`无法连接 Microsoft Xiaoxiao（${preferredVoiceName}）语音服务，请检查网络`);
    }
  } finally {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    speechPlaying = false;
    void speakNext();
  }
}

function queueVoice(text) {
  // TTS is generated by the server with Xiaoxiao; SpeechSynthesis is not the audio backend.
  if (!text || typeof Audio === "undefined") return;
  speechQueue.push(text);
  speakNext();
}

function normalizeSpeechVolume(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function normalizeMapLayer(value) {
  return ["standard", "satellite", "dark"].includes(value) ? value : "standard";
}

function applyTheme(darkMode = false) {
  document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
  if (els.themeModeBtn) {
    const currentTheme = darkMode ? "深色" : "浅色";
    const nextTheme = darkMode ? "浅色" : "深色";
    els.themeModeBtn.setAttribute("aria-label", `当前${currentTheme}模式，点击切换为${nextTheme}模式`);
    els.themeModeBtn.title = `切换为${nextTheme}模式`;
    els.themeModeBtn.setAttribute("aria-pressed", String(darkMode));
  }
}

function toggleThemeMode() {
  const darkMode = state.settings?.darkMode !== true;
  state.settings.darkMode = darkMode;
  applyTheme(darkMode);
  saveState();
  toast(`已切换为${darkMode ? "深色" : "浅色"}模式`);
}

function canCreateCompany() {
  const rankInfo = getRankInfo(state.stats?.totalHours || 0);
  const rank = rankInfo.rank;
  return rank === "机长" || rank === "教员" || Number(state.cash || 0) >= 1_000_000 || rankInfo.minHours >= 120;
}

function companyCreationRequirementText() {
  const rank = getRankInfo(state.stats?.totalHours || 0).rank;
  if (canCreateCompany()) return "已满足创建条件：机长资历或个人资金达到 100 万。";
  return `创建条件：达到机长（当前${rank}）或个人资金达到 100 万（当前 ${formatMoney(state.cash)}）。`;
}

function openSettings() {
  if (!els.settingsModal || !els.speechVolumeRange) return;
  settingsDraftSpeechVolume = normalizeSpeechVolume(state.settings?.speechVolume);
  els.speechVolumeRange.value = String(Math.round(settingsDraftSpeechVolume * 100));
  els.speechVolumeValue.textContent = `${els.speechVolumeRange.value}%`;
  if (els.freeModeToggle) els.freeModeToggle.checked = isFreeMode();
  if (els.sopModeToggle) els.sopModeToggle.checked = state.settings?.sopMode === true;
  renderBackups();
  void loadRuntimeLogs();
  els.settingsModal.returnValue = "";
  els.settingsModal.showModal();
  wireIcons();
}

function openSupport() {
  if (!els.supportModal) return;
  els.supportModal.showModal();
  wireIcons();
}

function openContactAuthor() {
  if (!els.contactModal) return;
  els.contactModal.showModal();
  wireIcons();
}

async function copyAuthorQqGroup() {
  const groupNumber = els.authorQqGroup?.textContent?.trim() || "1048217475";
  try {
    await navigator.clipboard.writeText(groupNumber);
    toast(`QQ群 ${groupNumber} 已复制`);
  } catch {
    toast(`QQ群：${groupNumber}`);
  }
}

function openAbout() {
  if (!els.aboutModal) return;
  els.aboutModal.showModal();
  wireIcons();
}

function updateSettingsVolumePreview() {
  const percent = Math.max(0, Math.min(100, Number(els.speechVolumeRange?.value) || 0));
  settingsDraftSpeechVolume = percent / 100;
  if (els.speechVolumeValue) els.speechVolumeValue.textContent = `${percent}%`;
}

function closeSettings() {
  if (!els.settingsModal) return;
  if (els.settingsModal.returnValue !== "confirm") {
    return;
  }
  state.settings.speechVolume = normalizeSpeechVolume(settingsDraftSpeechVolume);
  const nextFreeMode = els.freeModeToggle?.checked === true;
  const freeModeChanged = applyFreeModeFinancialState(nextFreeMode);
  state.settings.sopMode = !nextFreeMode && els.sopModeToggle?.checked === true;
  saveState();
  if (freeModeChanged) renderAll();
  else renderSopMonitor();
  toast(`设置已保存${state.settings.freeMode ? "，自由模式已开启，SOP 检测暂不生效" : state.settings.sopMode ? "，SOP 模式已开启" : ""}`);
}

function recordTaskEvent(mission, { key, title, detail, voiceText, phase }) {
  const normalizedKey = String(key || "").trim();
  if (!mission?.id || !normalizedKey || (!taskLogEventKeys.has(normalizedKey) && !normalizedKey.startsWith("sop-"))) return false;
  const isSopEvent = normalizedKey.startsWith("sop-");
  const exists = state.taskEvents.some((event) => {
    const sameMission = event.missionId === mission.id || event.missionTitle === mission.title;
    return sameMission
      && String(event.key || "").trim() === normalizedKey
      && (!isSopEvent || String(event.detail || "").trim() === String(detail || "").trim());
  });
  if (exists) return false;
  state.taskEvents.unshift({
    id: cryptoId("task-event"),
    missionId: mission.id,
    missionTitle: mission.title,
    date: Date.now(),
    phase: phase || mission.verification?.phase || "",
    key: normalizedKey,
    title: title || "任务状态更新",
    detail: detail || "",
    voiceText: voiceText || ""
  });
  state.taskEvents = state.taskEvents.slice(0, 100);
  if (voiceText) queueVoice(voiceText);
  return true;
}

function setMissionStatus(mission, { phase, label, detail, voiceKey, voiceText, eventKey, eventTitle, eventDetail }) {
  const verification = mission?.verification;
  if (!verification) return false;
  const changed = verification.phase !== phase || verification.phaseLabel !== label || verification.detail !== detail;
  verification.phase = phase;
  verification.phaseLabel = label;
  verification.detail = detail;
  if (voiceKey && verification.lastVoiceKey !== voiceKey && !eventKey) {
    verification.lastVoiceKey = voiceKey;
    queueVoice(voiceText);
  }
  if (voiceKey && eventKey && verification.lastVoiceKey !== voiceKey) {
    verification.lastVoiceKey = voiceKey;
  }
  if (changed && eventKey) {
    recordTaskEvent(mission, {
      key: eventKey,
      title: eventTitle || label,
      detail: eventDetail || detail,
      voiceText,
      phase
    });
  }
  return changed;
}

function updateRankAndAchievements() {
  const rank = getRankInfo(state.stats.totalHours);
  const next = rankRules.find((item) => item.minHours > state.stats.totalHours) || rankRules.at(-1);
  const progressMax = rank.nextHours || rank.minHours || 1;
  const progressValue = rank.nextHours ? ((state.stats.totalHours - rank.minHours) / (rank.nextHours - rank.minHours)) * 100 : 100;
  els.pilotRank.textContent = rank.rank;
  els.nextRankLabel.textContent = rank.label;
  els.rankProgressText.textContent = rank.nextHours ? `${Math.min(state.stats.totalHours, rank.nextHours)} / ${rank.nextHours} 小时` : "已达顶级";
  els.rankMeter.style.width = `${Math.max(0, Math.min(100, progressValue))}%`;
  if (next && next.rank !== rank.rank) {
    els.careerGoal.textContent = `继续积累 ${next.minHours - state.stats.totalHours > 0 ? next.minHours - state.stats.totalHours : 0} 小时，向 ${next.rank} 迈进`;
    els.careerGoalText.textContent = `当前阶段：${rank.rank}。完成任务、记录航段或手动同步后，系统会自动更新薪资、声望与解锁等级。`;
  } else {
    els.careerGoal.textContent = `你已经达到 ${rank.rank}`;
    els.careerGoalText.textContent = "继续提升声望，优化机队并挑战更高收益任务。";
  }

  state.achievements = achievementDefs.map((def) => {
    const unlocked = def.test(state);
    return { id: def.id, unlocked };
  });
}

function renderProfile() {
  const rank = getRankInfo(state.stats.totalHours);
  renderAvatar(els.pilotInitials, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
  renderAvatar(els.pilotAvatarPreview, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
  renderAvatarChoices();
  els.pilotName.textContent = state.pilot.loggedIn ? state.pilot.name : "未登录";
  els.loginPilotBtn.innerHTML = state.pilot.loggedIn
    ? `<i data-lucide="log-out"></i><span>退出</span>`
    : `<i data-lucide="log-in"></i><span>登录</span>`;
  els.pilotRank.textContent = rank.rank;
  els.totalHours.textContent = state.stats.totalHours.toFixed(1);
  els.reputation.textContent = state.reputation;
  els.balance.textContent = formatCompactMoney(state.cash);
  els.totalMiles.textContent = `${state.stats.totalMiles.toLocaleString("en-US")} nm`;
  els.totalLandings.textContent = state.stats.totalLandings.toLocaleString("en-US");
  els.completedCount.textContent = state.stats.completedMissions.toLocaleString("en-US");
  els.activeMissionCount.textContent = `${selectedMissions().length} 个待飞`;
  const fleetLeader = [...state.fleet].sort((a, b) => getAircraftHours(b.id) - getAircraftHours(a.id))[0];
  els.topAircraft.textContent = fleetLeader ? fleetLeader.name : "暂无";
  els.topAircraftHours.textContent = fleetLeader ? `${getAircraftHours(fleetLeader.id).toFixed(1)} 小时` : "0 小时";
  const trend = state.stats.totalHours >= 20 ? "已进入晋升窗口" : "先积累基础飞行时数";
  els.milesTrend.textContent = trend;
}

function getAircraftHours(id) {
  return state.logs.filter((log) => log.aircraftId === id).reduce((sum, log) => sum + Number(log.hours || 0), 0);
}

function logoUrl(airline) {
  return `${LOGO_BASE_URL}${airline?.code || "default"}.png`;
}

function fallbackLogoUrl() {
  return `${LOGO_BASE_URL}default.png`;
}

function airlineLogo(airline, className = "airline-logo") {
  const name = airline?.name || "Airline";
  return `<img class="${className}" src="${logoUrl(airline)}" alt="${name} logo" onerror="this.onerror=null;this.src='${fallbackLogoUrl()}';">`;
}

function renderAirline() {
  const company = state.company?.created ? state.company : null;
  if (els.airlinePanel) els.airlinePanel.hidden = !company;
  if (!company) {
    if (els.airlineMeta) els.airlineMeta.innerHTML = "";
    return;
  }
  const airlineId = company?.airlineId || state.airlineId;
  const airline = airlines.find((item) => item.id === airlineId) || airlines[0];
  const base = company ? companyBase() : null;
  if (els.airlinePanelTitle) els.airlinePanelTitle.textContent = company ? "我的航空公司" : "就职航空公司";
  els.airlineMeta.innerHTML = `
    <div class="mission-card airline-card" style="background:var(--surface-2);box-shadow:none;">
      <div class="mission-head">
        <div class="airline-title">
          ${airlineLogo(airline)}
          <div>
          <h3>${escapeHtml(company?.name || airline.name)}</h3>
            <p>${escapeHtml(airline.name)} · ${airline.code} · ${company ? `基地 ${escapeHtml(company.base)}${base?.name ? ` · ${escapeHtml(base.name)}` : ""}` : escapeHtml(airline.type)}</p>
          </div>
        </div>
        <span class="tag ${airline.color}">${company ? "运营中" : "当前就职"}</span>
      </div>
      <div class="tag-row">
        ${company ? `<span class="tag good">公司资金 ${formatMoney(company.funds)}</span><span class="tag">${company.pilots.filter((pilot) => pilot.status !== "fired").length} 名飞行员</span><span class="tag">${companyManagedFleet().length} 架飞机</span>` : `<span class="tag">声望要求 ${airline.rep}</span><span class="tag">建议 ${airline.region}</span><span class="tag info">与任务独立</span>`}
      </div>
    </div>`;
}

function renderMissions() {
  const missions = state.missions.slice().filter((mission) => mission && missionVisibleForBase(mission));
  const open = missions.filter((mission) => mission.status !== "completed");
  const recommended = open.slice(0, 3);
  const filters = state.missionFilters || { search: "", status: "all", category: "all", distanceSort: "near" };
  const query = String(filters.search || "").trim().toUpperCase();
  const filteredMissions = missions.filter((mission) => {
    const searchable = `${mission.title} ${mission.route} ${mission.summary} ${mission.category} ${mission.subtype}`.toUpperCase();
    const matchesSearch = !query || searchable.includes(query);
    const matchesStatus = filters.status === "all" || mission.status === filters.status;
    const matchesCategory = filters.category === "all" || mission.category === filters.category;
    return matchesSearch && matchesStatus && matchesCategory;
  });
  const visibleMissions = filteredMissions.sort((a, b) => {
    if (filters.distanceSort === "near" || filters.distanceSort === "far") {
      const distanceDelta = missionDistanceNm(a) - missionDistanceNm(b);
      if (distanceDelta !== 0) return filters.distanceSort === "near" ? distanceDelta : -distanceDelta;
    }
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
  els.missionSearch.value = filters.search || "";
  els.missionDistanceSort.value = filters.distanceSort || "near";
  els.missionStatusFilter.value = filters.status || "all";
  els.missionCategoryButtons.forEach((button) => {
    const active = (button.dataset.missionCategory || "all") === (filters.category || "all");
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  els.missionResultCount.textContent = `${visibleMissions.length} / ${missions.length} 个任务`;
  els.recommendedMissions.innerHTML = recommended.map(renderMissionCard).join("") || emptyCard("暂无可推荐任务");
  els.missionsList.innerHTML = visibleMissions.map(renderMissionListItem).join("") || `<p class="mission-list-empty">没有符合条件的任务。</p>`;
  void loadMissionMetars(visibleMissions);
}

function missionDistanceNm(mission) {
  const distance = Number(mission?.site?.distanceNm ?? mission?.distance);
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

function routeAirportCodes(mission) {
  return String(mission.title || "").match(/[A-Z]{4}/g) || [];
}

function missionMetarAirportCodes(missions) {
  return [...new Set(missions.flatMap((mission) => {
    const codes = routeAirportCodes(mission);
    return [mission.origin || codes[0], mission.destination || codes[1]];
  }).filter((code) => /^[A-Z]{4}$/.test(String(code || "").toUpperCase())).map((code) => String(code).toUpperCase()))];
}

function metarObservationMeta(report) {
  if (!report || report.unavailable) return "暂无最新报文";
  const observedAt = Date.parse(report.observedAt);
  if (!Number.isFinite(observedAt)) return report.stale ? "缓存报文" : "最新报文";
  const minutes = Math.max(0, Math.round((Date.now() - observedAt) / 60000));
  return `${minutes} 分钟前 · ${report.stale ? "缓存" : "AWC"}`;
}

function missionMetarLine(icao, label, fallbackWeather) {
  const code = String(icao || "").toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    return `<div class="mission-metar-line is-unavailable"><span>${label}</span><div><b>任务现场</b><code>无机场 METAR · ${escapeHtml(fallbackWeather || "按现场条件执行")}</code></div></div>`;
  }
  const report = missionMetarCache.get(code);
  const raw = report?.raw || (report?.unavailable ? `暂无报文 · ${fallbackWeather || "按任务天气执行"}` : "正在获取最新报文...");
  return `<div class="mission-metar-line" data-metar-icao="${code}" data-metar-fallback="${escapeHtml(fallbackWeather || "按任务天气执行")}">
    <span>${label}</span>
    <div><b>${code}</b><code>${escapeHtml(raw)}</code><small>${metarObservationMeta(report)}</small></div>
  </div>`;
}

function updateMissionMetarReadouts() {
  document.querySelectorAll("[data-metar-icao]").forEach((node) => {
    const report = missionMetarCache.get(node.dataset.metarIcao);
    const fallback = node.dataset.metarFallback || "按任务天气执行";
    const code = node.querySelector("code");
    const meta = node.querySelector("small");
    if (code) code.textContent = report?.raw || (report?.unavailable ? `暂无报文 · ${fallback}` : "正在获取最新报文...");
    if (meta) meta.textContent = metarObservationMeta(report);
  });
}

async function loadMissionMetars(missions) {
  const codes = missionMetarAirportCodes(missions);
  const now = Date.now();
  const needed = codes.filter((code) => now - Number(missionMetarCache.get(code)?.fetchedAt || 0) >= missionMetarClientTtlMs);
  if (!needed.length || missionMetarPromise) {
    updateMissionMetarReadouts();
    return missionMetarPromise;
  }
  missionMetarPromise = (async () => {
    try {
      const response = await fetch(`/api/metar?ids=${encodeURIComponent(needed.join(","))}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "metar-unavailable");
      needed.forEach((code) => {
        const report = payload.observations?.[code];
        missionMetarCache.set(code, report
          ? { ...report, fetchedAt: now }
          : { unavailable: true, fetchedAt: now });
      });
    } catch {
      needed.forEach((code) => missionMetarCache.set(code, { unavailable: true, fetchedAt: now }));
    } finally {
      missionMetarPromise = null;
      updateMissionMetarReadouts();
    }
  })();
  return missionMetarPromise;
}

function missionMapRoute(mission) {
  const codes = routeAirportCodes(mission);
  const origin = airportByIcao(mission.origin || codes[0] || state.pilot.base);
  const scenePoint = mission.site?.lat != null && mission.site?.lon != null
    ? { lat: mission.site.lat, lon: mission.site.lon, icao: "现场", name: "任务现场" }
    : null;
  const destination = scenePoint || airportByIcao(mission.destination || codes[1]);
  if (!origin || !destination) return null;
  return {
    mission,
    origin,
    destination,
    isScene: Boolean(scenePoint),
    label: scenePoint ? `${mission.title} · 任务现场` : `${origin.icao} -> ${destination.icao}`
  };
}

function mapZoomForPoints(points) {
  const span = points.reduce((largest, point, index) => Math.max(largest, ...points.slice(index + 1).map((other) => distanceNm(point, other))), 0);
  if (span < 18) return 11;
  if (span < 55) return 9;
  if (span < 160) return 8;
  if (span < 420) return 7;
  if (span < 900) return 6;
  return 4;
}

function loadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./assets/vendor/leaflet/leaflet.js";
    script.async = true;
    script.onload = () => window.L?.map ? resolve(window.L) : reject(new Error("Leaflet 未初始化"));
    script.onerror = () => reject(new Error("Leaflet 脚本资源加载失败"));
    document.head.appendChild(script);
  }).catch((error) => {
    leafletLoadPromise = null;
    throw error;
  });
  return leafletLoadPromise;
}

function activeMissionMapRoutes() {
  return state.missions
    .filter((mission) => mission.status === "accepted")
    .sort((a, b) => b.acceptedAt - a.acceptedAt)
    .map(missionMapRoute)
    .filter(Boolean);
}

function companyTaskMapPoint(task, now = Date.now()) {
  const origin = companyAirportByIcao(task?.origin || state.company?.base);
  const destination = companyAirportByIcao(task?.destination);
  if (!origin) return null;
  if (!destination || !Number.isFinite(Number(task?.assignedAt))) {
    return { lat: origin.lat, lon: origin.lon, heading: null, progress: 0, origin, destination: null };
  }
  const distance = Math.max(20, Number(task.distance) || distanceNm(origin, destination));
  const durationMs = Math.max(15 * 60 * 1000, Math.min(8 * 3600 * 1000, distance / 380 * 3600 * 1000));
  const progress = Math.max(0, Math.min(0.98, (now - Number(task.assignedAt)) / durationMs));
  return {
    lat: origin.lat + (destination.lat - origin.lat) * progress,
    lon: origin.lon + (destination.lon - origin.lon) * progress,
    heading: bearingBetweenPoints(origin, destination),
    progress,
    origin,
    destination
  };
}

function activeCompanyMapFlights(now = Date.now()) {
  if (!state.company?.created) return [];
  const base = companyAirportByIcao(state.company.base);
  const fleet = companyManagedFleet();
  if (!base || !fleet.length) return [];
  const pilots = state.company.pilots.filter((pilot) => pilot.status === "active");
  return pilots.map((pilot, index) => {
    const task = state.company.tasks.find((item) => item.id === pilot.assignedTaskId && item.status === "assigned") || null;
    const aircraft = task
      ? state.fleet.find((item) => item.id === task.aircraftId)
      : fleet[index % fleet.length];
    const position = task ? companyTaskMapPoint(task, now) : { lat: base.lat, lon: base.lon, heading: null, progress: 0 };
    if (!aircraft || !position) return null;
    return { id: pilot.id, pilot, aircraft, task, ...position };
  }).filter(Boolean);
}

function syncMapTrackingControl() {
  if (!els.followAircraftBtn) return;
  const enabled = state.settings?.mapAutoTrack === true;
  els.followAircraftBtn.classList.toggle("is-active", enabled);
  els.followAircraftBtn.setAttribute("aria-pressed", String(enabled));
  els.followAircraftBtn.setAttribute("aria-label", enabled ? "关闭自动跟踪飞机" : "自动跟踪飞机");
  els.followAircraftBtn.title = enabled ? "关闭自动跟踪飞机" : "自动跟踪飞机";
}

function syncCompanyAircraftControl() {
  if (!els.toggleCompanyAircraftBtn) return;
  const enabled = state.settings?.mapShowCompanyAircraft !== false;
  els.toggleCompanyAircraftBtn.classList.toggle("is-active", enabled);
  els.toggleCompanyAircraftBtn.setAttribute("aria-pressed", String(enabled));
  els.toggleCompanyAircraftBtn.setAttribute("aria-label", enabled ? "隐藏公司飞机" : "显示公司飞机");
  els.toggleCompanyAircraftBtn.title = enabled ? "隐藏公司飞机" : "显示公司飞机";
}

function toggleCompanyAircraft() {
  state.settings.mapShowCompanyAircraft = state.settings?.mapShowCompanyAircraft === false;
  saveState();
  syncCompanyAircraftControl();
  updateCompanyAircraftOnMap();
  toast(state.settings.mapShowCompanyAircraft ? "已显示公司飞机" : "已隐藏公司飞机");
}

function toggleMapTracking() {
  const enabled = state.settings?.mapAutoTrack !== true;
  state.settings.mapAutoTrack = enabled;
  saveState();
  syncMapTrackingControl();
  const point = telemetryMapPoint(lastTelemetry);
  if (enabled && leafletMap && point) {
    leafletMap.setView([point.lat, point.lon], leafletMap.getZoom(), { animate: false });
  }
  toast(enabled ? "已开启自动跟踪飞机" : "已关闭自动跟踪飞机");
}

function syncMapLayerControls() {
  const activeLayer = normalizeMapLayer(state.settings?.mapLayer);
  els.mapLayerControls.forEach((button) => {
    const active = button.dataset.mapLayer === activeLayer;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setMapLayer(layer) {
  state.settings.mapLayer = normalizeMapLayer(layer);
  saveState();
  syncMapLayerControls();
  renderMapPage();
}

function renderMapPage() {
  const routes = activeMissionMapRoutes();
  syncMapTrackingControl();
  syncCompanyAircraftControl();
  syncMapLayerControls();
  const base = airportByIcao(state.pilot.base);
  const mapRoutes = routes.length ? routes : base ? [{ origin: base, destination: base, isBase: true, label: `基地 ${base.icao}` }] : [];
  els.mapPageTitle.textContent = routes.length ? (routes.length === 1 ? "当前执行任务" : "执行任务") : "基地机场";
  els.mapPageSummary.textContent = routes.length ? "已接任务会显示起点、任务点和航线。" : (base ? `${base.icao} · ${base.name}` : "请先在飞行员档案中设置有效 ICAO 基地机场。");
  els.mapPageCount.textContent = routes.length ? `${routes.length} 个执行中` : "基地定位";
  els.mapTaskList.innerHTML = mapRoutes.map((route) => `
    <div class="map-task-item">
      <b>${route.isBase ? "基地" : route.isScene ? "现场" : "航线"}</b>
      <span>${escapeHtml(route.label)}</span>
      ${route.isBase ? "" : `<small>${route.mission.category} · ${formatTaskDistanceNm(route.mission.distance)}</small>`}
    </div>
  `).join("") || `<p class="empty-note">当前基地没有匹配坐标，无法定位地图。</p>`;
  if (state.activeView !== "map") return;
  if (window.location.protocol === "file:") {
    els.careerMap.innerHTML = `<div class="mission-map-loading is-error">正在打开本地地图服务...</div>`;
    window.location.replace("http://localhost:4174/");
    return;
  }
  if (!mapRoutes.length) {
    els.careerMap.innerHTML = `<div class="mission-map-loading is-error">无法定位基地机场，请检查 ICAO 代码。</div>`;
    return;
  }
  els.careerMap.innerHTML = `<div class="mission-map-loading">正在加载地图...</div>`;
  loadLeaflet()
    .then(() => drawLeafletMap(els.careerMap, mapRoutes))
    .catch(() => {
      els.careerMap.innerHTML = `<div class="mission-map-loading is-error">地图暂时无法加载，请检查网络或地图服务配置。</div>`;
    });
}

function mapMarkerIcon(kind, label) {
  return window.L.divIcon({
    className: "career-map-marker-wrap",
    html: `<span class="career-map-marker is-${kind}"></span><span class="career-map-marker-label">${escapeHtml(label)}</span>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5]
  });
}

function telemetryMapPoint(sample) {
  const lat = Number(sample?.latitude);
  const lon = Number(sample?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function normalizeHeading(value) {
  const heading = Number(value);
  return Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : null;
}

function bearingBetweenPoints(from, to) {
  if (!from || !to) return null;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const deltaLon = (to.lon - from.lon) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return normalizeHeading(Math.atan2(y, x) * 180 / Math.PI);
}

function aircraftHeading(sample, point) {
  // Match the cockpit HDG indication (magnetic). True heading remains in the
  // telemetry payload for route/geospatial calculations.
  const reported = normalizeHeading(sample?.magneticHeadingDeg ?? sample?.headingMagneticDeg ?? sample?.headingDeg ?? sample?.trueHeadingDeg);
  if (reported != null) return reported;
  const previous = liveTrackPoints.at(-1);
  const moved = previous && Math.abs(previous.lat - point.lat) + Math.abs(previous.lon - point.lon) >= 0.00003;
  return moved ? bearingBetweenPoints(previous, point) ?? lastLiveHeadingDeg : lastLiveHeadingDeg;
}

function aircraftDisplaySpeed(sample) {
  const candidates = [
    ["TAS", sample?.trueAirspeedKt],
    ["IAS", sample?.indicatedAirspeedKt],
    ["GS", sample?.groundSpeedKt]
  ];
  const selected = candidates.find(([, value]) => value != null && value !== "" && Number.isFinite(Number(value)));
  return selected
    ? { label: selected[0], value: Math.max(0, Number(selected[1])) }
    : { label: "GS", value: 0 };
}

function aircraftIconRotation(headingDeg) {
  if (headingDeg == null || headingDeg === "") return -45;
  const heading = normalizeHeading(headingDeg);
  return heading == null ? -45 : normalizeHeading(heading - 45);
}

function liveAircraftIcon(connected, headingDeg) {
  const iconRotation = aircraftIconRotation(headingDeg);
  return window.L.divIcon({
    className: "live-aircraft-marker-wrap",
    html: `<span class="live-aircraft-marker ${connected ? "is-live" : "is-stale"}"><i data-lucide="plane" class="live-aircraft-symbol" style="transform: rotate(${iconRotation}deg)" aria-hidden="true"></i></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function companyAircraftIcon(headingDeg) {
  const iconRotation = aircraftIconRotation(headingDeg);
  return window.L.divIcon({
    className: "company-aircraft-marker-wrap",
    html: `<span class="company-aircraft-marker"><i data-lucide="plane" class="live-aircraft-symbol" style="transform: rotate(${iconRotation}deg)" aria-hidden="true"></i></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function updateCompanyAircraftOnMap(now = Date.now()) {
  if (!leafletMap || !window.L?.marker) return;
  const enabled = state.settings?.mapShowCompanyAircraft !== false;
  const flights = enabled ? activeCompanyMapFlights(now) : [];
  const activeIds = new Set(flights.map((flight) => flight.id));
  companyAircraftMarkers.forEach((marker, id) => {
    if (!activeIds.has(id)) {
      marker.remove();
      companyAircraftMarkers.delete(id);
    }
  });
  flights.forEach((flight) => {
    const latLng = [flight.lat, flight.lon];
    const status = flight.task
      ? `派遣中 · ${Math.round(flight.progress * 100)}% · ${flight.task.origin} → ${flight.task.destination}`
      : "基地待命";
    const label = `${flight.pilot.name} · ${flight.aircraft.name}`;
    let marker = companyAircraftMarkers.get(flight.id);
    if (!marker) {
      marker = window.L.marker(latLng, {
        icon: companyAircraftIcon(flight.heading),
        keyboard: false,
        zIndexOffset: 850
      }).addTo(leafletMap);
      companyAircraftMarkers.set(flight.id, marker);
    } else {
      marker.setLatLng(latLng);
      marker.setIcon(companyAircraftIcon(flight.heading));
    }
    marker.bindTooltip(`<strong>${escapeHtml(label)}</strong><br>${escapeHtml(status)}`, {
      direction: "top",
      offset: [0, -14]
    });
  });
  wireIcons();
}

function updateLiveAircraftOnMap(sample, connected = true) {
  if (!leafletMap || !window.L?.marker) return;
  const point = telemetryMapPoint(sample);
  if (!point) return;
  const latLng = [point.lat, point.lon];
  const timestamp = String(sample?.timestamp || "");
  const heading = aircraftHeading(sample, point);
  lastLiveHeadingDeg = heading;
  if (!liveAircraftMarker) {
    liveAircraftMarker = window.L.marker(latLng, {
      icon: liveAircraftIcon(connected, heading),
      keyboard: false,
      zIndexOffset: 1000
    }).addTo(leafletMap);
  } else {
    liveAircraftMarker.setLatLng(latLng);
    liveAircraftMarker.setIcon(liveAircraftIcon(connected, heading));
  }
  wireIcons();
  const speed = aircraftDisplaySpeed(sample);
  const altitude = Math.round(Number(sample?.altitudeFt) || 0);
  liveAircraftMarker.bindTooltip(`${connected ? "MSFS 实时位置" : "MSFS 最后位置"}<br>${speed.label} ${Math.round(speed.value)} kt · ${altitude} ft · 航向 ${String(Math.round(heading)).padStart(3, "0")}°`, {
    direction: "top",
    offset: [0, -14]
  });
  if (connected && timestamp && timestamp !== lastLiveTrackTimestamp) {
    const previous = liveTrackPoints.at(-1);
    if (!previous || Math.abs(previous.lat - point.lat) + Math.abs(previous.lon - point.lon) >= 0.00003) {
      liveTrackPoints.push(point);
      if (liveTrackPoints.length > 240) liveTrackPoints.shift();
    }
    lastLiveTrackTimestamp = timestamp;
  }
  if (liveTrackPoints.length > 1) {
    const trackLatLngs = liveTrackPoints.map((trackPoint) => [trackPoint.lat, trackPoint.lon]);
    if (!liveTrackLine) {
      liveTrackLine = window.L.polyline(trackLatLngs, {
        color: "#087f8c",
        weight: 3,
        opacity: 0.85
      }).addTo(leafletMap);
    } else {
      liveTrackLine.setLatLngs(trackLatLngs);
    }
  }
  if (state.settings?.mapAutoTrack === true) {
    leafletMap.setView(latLng, leafletMap.getZoom(), { animate: false });
  }
}

function addMapMarker(map, point, kind, label) {
  return window.L.marker([point.lat, point.lon], { icon: mapMarkerIcon(kind, label), keyboard: false })
    .addTo(map)
    .bindTooltip(escapeHtml(label), { direction: "top", offset: [0, -7] });
}

function drawLeafletMap(host, routes) {
  if (state.activeView !== "map" || !window.L?.map) return;
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
    liveAircraftMarker = null;
    liveTrackLine = null;
    companyAircraftMarkers.clear();
  }
  host.replaceChildren();
  const mapLayer = normalizeMapLayer(state.settings?.mapLayer);
  host.classList.toggle("map-layer-dark", mapLayer === "dark");
  const map = window.L.map(host, { zoomControl: true, attributionControl: true, preferCanvas: true });
  leafletMap = map;
  const tilePrefix = mapLayer === "satellite" ? "img" : "vec";
  const labelPrefix = mapLayer === "satellite" ? "cia" : "cva";
  window.L.tileLayer(`/api/map/tianditu/${tilePrefix}/{z}/{x}/{y}`, {
    maxZoom: 18,
    attribution: "&copy; 天地图"
  }).addTo(map);
  window.L.tileLayer(`/api/map/tianditu/${labelPrefix}/{z}/{x}/{y}`, {
    maxZoom: 18
  }).addTo(map);
  const points = [];
  routes.forEach((route) => {
    points.push(route.origin);
    addMapMarker(map, route.origin, route.isBase ? "base" : "origin", route.isBase ? `基地 ${route.origin.icao}` : `起点 ${route.origin.icao}`);
    if (route.isBase) return;
    points.push(route.destination);
    addMapMarker(map, route.destination, route.isScene ? "scene" : "destination", route.isScene ? "任务现场" : `终点 ${route.destination.icao}`);
    window.L.polyline([[route.origin.lat, route.origin.lon], [route.destination.lat, route.destination.lon]], {
      color: route.isScene ? "#bc6b13" : "#1f63d0",
      weight: 3,
      opacity: 0.9,
      dashArray: route.isScene ? "7 6" : null
    }).addTo(map).bindTooltip(escapeHtml(route.label), { sticky: true });
  });
  const livePoint = telemetryMapPoint(lastTelemetry);
  if (livePoint) points.push(livePoint);
  if (points.length === 1) {
    map.setView([points[0].lat, points[0].lon], mapZoomForPoints(points));
  } else {
    map.fitBounds(points.map((point) => [point.lat, point.lon]), { padding: [48, 48], maxZoom: 10 });
  }
  if (livePoint) updateLiveAircraftOnMap(lastTelemetry, lastTelemetryConnected);
  updateCompanyAircraftOnMap();
}

function updatePlanAirportFields() {
  const originCode = normalizeAirportInputCode(els.planOriginInput?.value);
  const destinationCode = normalizeAirportInputCode(els.planDestinationInput?.value);
  if (els.planOriginInput) els.planOriginInput.value = originCode;
  if (els.planDestinationInput) els.planDestinationInput.value = destinationCode;
  const origin = originCode.length === 4 ? companyAirportByIcao(originCode) : null;
  const destination = destinationCode.length === 4 ? companyAirportByIcao(destinationCode) : null;
  const updateResult = (output, code, airport) => {
    if (!output) return;
    output.textContent = code.length < 4 ? "" : airport ? `${airport.name} · ${airport.city || airport.country || "全球机场"}` : "未找到对应机场";
    output.classList.toggle("is-valid", Boolean(airport));
    output.classList.toggle("is-invalid", code.length === 4 && !airport);
  };
  updateResult(els.planOriginResult, originCode, origin);
  updateResult(els.planDestinationResult, destinationCode, destination);
  const aircraft = selectedPlanAircraft();
  if (els.generatePlannedMissionBtn) {
    els.generatePlannedMissionBtn.disabled = !origin || !destination || origin.icao === destination.icao || !aircraft;
  }
  return { origin, destination, aircraft };
}

function availablePlanAircraft() {
  return (Array.isArray(state?.fleet) ? state.fleet : [])
    .filter((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented));
}

function selectedPlanAircraft() {
  const available = availablePlanAircraft();
  const selectedId = String(els.planAircraftSelect?.value || "");
  if (selectedId) return available.find((aircraft) => aircraft.id === selectedId) || null;
  return available.find((aircraft) => aircraft.selected)
    || available[0]
    || null;
}

function renderPlanAircraftOptions() {
  if (!els.planAircraftSelect) return;
  const previousId = String(els.planAircraftSelect.value || "");
  const available = availablePlanAircraft();
  const preferred = available.find((aircraft) => aircraft.id === previousId)
    || available.find((aircraft) => aircraft.selected)
    || available[0]
    || null;
  els.planAircraftSelect.innerHTML = available.length
    ? available.map((aircraft) => `<option value="${escapeHtml(aircraft.id)}">${escapeHtml(aircraft.name)} · ${escapeHtml(aircraft.kind)} · ${aircraft.owned ? "已购买" : "租赁"}</option>`).join("")
    : `<option value="">暂无已购买或租赁飞机</option>`;
  els.planAircraftSelect.disabled = available.length === 0;
  els.planAircraftSelect.value = preferred?.id || "";
  if (els.planAircraftHint) {
    els.planAircraftHint.textContent = available.length ? `可选 ${available.length} 架个人飞机（含租赁）` : "请先到飞机市场购买或租赁飞机";
    els.planAircraftHint.classList.toggle("is-empty", available.length === 0);
  }
}

function plannedMissionCruiseSpeed(aircraft) {
  if (isHelicopterAircraft(aircraft)) return 115;
  if (/喷气|客机|运输/.test(String(aircraft?.kind || ""))) return 430;
  if (/涡桨/.test(String(aircraft?.kind || ""))) return 260;
  return 145;
}

function generatePlannedMission() {
  const { origin, destination, aircraft } = updatePlanAirportFields();
  if (!origin || !destination) {
    toast("请输入有效的起飞和降落机场四字码");
    return null;
  }
  if (origin.icao === destination.icao) {
    toast("起飞机场和降落机场不能相同");
    return null;
  }
  if (!aircraft) {
    toast("请选择已购买或租赁的个人飞机后再创建计划任务");
    return null;
  }
  const standardCategories = compatibleCategories(aircraft).filter((category) => ["客运", "货运", "包机", "医疗"].includes(category));
  const category = standardCategories.includes("包机") ? "包机" : standardCategories[0] || "包机";
  const distance = Math.round(distanceNm(origin, destination));
  const duration = +Math.max(0.2, distance / plannedMissionCruiseSpeed(aircraft)).toFixed(1);
  const mission = {
    id: cryptoId("plan-mission"),
    kind: "planned-route",
    category,
    subtype: "计划航线",
    title: `${origin.icao} → ${destination.icao}`,
    route: `${origin.name} → ${destination.name}`,
    origin: origin.icao,
    destination: destination.icao,
    site: null,
    aircraftHint: aircraft.name,
    permittedAircraftIds: [aircraft.id],
    dispatchPhase: "全天候",
    recommendedPhases: ["全天候"],
    distance,
    duration,
    payout: Math.round(1200 + distance * 24),
    repGain: Math.max(2, Math.round(duration * 2)),
    risk: distance > 1800 ? "高" : distance > 600 ? "中" : "低",
    weather: "实时天气",
    scene: buildMissionScene(category, "计划航线"),
    summary: `计划任务 · ${origin.name} 至 ${destination.name}`,
    status: "open",
    priority: "standard",
    refreshable: false,
    createdAt: Date.now()
  };
  state.missions.unshift(mission);
  state.schedules.unshift({
    id: cryptoId("route-plan"),
    kind: "route-plan",
    missionId: mission.id,
    origin: origin.icao,
    originName: origin.name,
    destination: destination.icao,
    destinationName: destination.name,
    aircraftId: aircraft.id,
    aircraftName: aircraft.name,
    distance,
    createdAt: mission.createdAt,
    importedAt: mission.createdAt,
    imported: 1,
    total: 1,
    errors: []
  });
  state.missionFilters = { search: mission.title, status: "all", category: "all", distanceSort: "newest" };
  saveState();
  renderAll();
  toast(`已生成计划任务：${mission.title}`);
  showView("missions");
  return mission;
}

function renderSchedules() {
  renderPlanAircraftOptions();
  updatePlanAirportFields();
  const plannedRecords = state.schedules.filter((record) => record?.kind === "route-plan");
  const plannedMissions = plannedRecords
    .map((record) => state.missions.find((mission) => mission.id === record.missionId))
    .filter(Boolean);
  const totalDistance = plannedRecords.reduce((sum, record) => sum + (Number(record.distance) || 0), 0);
  els.scheduleSummary.innerHTML = `
    <div class="metric-grid schedule-metrics">
      <article class="metric-card"><span>计划航线</span><strong>${plannedRecords.length}</strong><em>已创建的指定航线</em></article>
      <article class="metric-card"><span>待执行</span><strong>${plannedMissions.filter((mission) => mission.status === "open").length}</strong><em>可在任务页接受</em></article>
      <article class="metric-card"><span>执行中</span><strong>${plannedMissions.filter((mission) => mission.status === "accepted").length}</strong><em>当前计划任务</em></article>
      <article class="metric-card"><span>计划里程</span><strong>${Math.round(totalDistance).toLocaleString("zh-CN")}</strong><em>累计海里</em></article>
    </div>`;
  els.scheduleList.innerHTML = state.schedules.map(renderScheduleBatch).join("") || `
    <article class="mission-card">
      <div class="mission-head">
        <div>
          <h3>暂无计划表记录</h3>
          <p>完成任务后，历史计划任务记录会显示在这里。</p>
        </div>
      </div>
    </article>`;
}

function renderBackups() {
  const backups = readBackups();
  els.backupList.innerHTML = backups.map((backup) => `
    <article class="backup-row">
      <div>
        <strong>${escapeHtml(backup.reason || "手动备份")}</strong>
        <span>${new Date(backup.createdAt).toLocaleString("zh-CN")}</span>
      </div>
      <button class="ghost-btn" data-action="restore-backup" data-id="${backup.id}" type="button"><i data-lucide="history"></i><span>恢复</span></button>
    </article>`).join("") || `<p class="empty-note">暂无备份。导入存档前会自动创建。</p>`;
}

function renderScheduleBatch(batch) {
  if (batch?.kind === "route-plan") {
    const mission = state.missions.find((item) => item.id === batch.missionId);
    const status = mission ? statusText(mission.status) : "历史记录";
    const statusClass = mission?.status === "completed" ? "good" : mission?.status === "accepted" ? "info" : "warn";
    return `
      <article class="mission-card planned-route-record">
        <div class="mission-head">
          <div>
            <h3>${escapeHtml(batch.origin)} → ${escapeHtml(batch.destination)}</h3>
            <p>${escapeHtml(batch.originName || batch.origin)} → ${escapeHtml(batch.destinationName || batch.destination)} · ${Math.round(Number(batch.distance) || 0)} nm</p>
          </div>
          <span class="tag ${statusClass}">${status}</span>
        </div>
        <div class="tag-row"><span class="tag">${new Date(batch.createdAt || batch.importedAt).toLocaleString("zh-CN")}</span><span class="tag info">计划任务</span>${batch.aircraftName ? `<span class="tag">机型 ${escapeHtml(batch.aircraftName)}</span>` : ""}</div>
      </article>`;
  }
  const errors = Array.isArray(batch?.errors) ? batch.errors : [];
  const errorHtml = errors.length
    ? `<div class="schedule-errors">${errors.slice(0, 5).map((error) => `<p>第 ${error.line} 行：${error.reason}</p>`).join("")}${errors.length > 5 ? `<p>还有 ${errors.length - 5} 个问题未显示</p>` : ""}</div>`
    : "";
  return `
    <article class="mission-card">
      <div class="mission-head">
        <div>
          <h3>${batch.fileName}</h3>
          <p>${new Date(batch.importedAt).toLocaleString("zh-CN")} · ${batch.airlineCode}</p>
        </div>
        <span class="tag ${errors.length ? "warn" : "good"}">${batch.imported} / ${batch.total} 已导入</span>
      </div>
      <div class="tag-row">
        <span class="tag">航司 ${batch.airlineCode}</span>
        <span class="tag">有效 ${batch.imported}</span>
        <span class="tag">失败 ${errors.length}</span>
      </div>
      ${errorHtml}
    </article>`;
}

function missionFuelBurnKgPerHour(aircraft) {
  const label = `${aircraft?.kind || ""} ${aircraft?.name || ""}`;
  if (/超大型|A380|747/.test(label)) return 9200;
  if (/宽体|A330|A340|A350|767|777|787|MD-11/.test(label)) return 6200;
  if (/军用运输|C-17|A400M/.test(label)) return 4300;
  if (/干线喷气|A319|A320|A321|737|757/.test(label)) return 2450;
  if (/支线客机|CRJ|Embraer|E-Jet|BAe|Avro|Fokker/.test(label)) return 950;
  if (/公务喷气|Citation|Pilatus PC-24/.test(label)) return 780;
  if (/重型直升机|H225|S-64|CH-47/.test(label)) return 620;
  if (/直升机|旋翼机/.test(label)) return 145;
  if (/涡桨|SkyCourier|Twin Otter|Saab/.test(label)) return 360;
  if (/双发/.test(label)) return 190;
  return 48;
}

function roundedFuelKg(value) {
  const step = value >= 1000 ? 100 : value >= 100 ? 10 : 5;
  return Math.ceil(value / step) * step;
}

function missionFuelPlan(mission) {
  const aircraft = missionAircraft(mission);
  const burnRate = missionFuelBurnKgPerHour(aircraft);
  const duration = Math.max(0.3, Number(mission.duration) || 0.6);
  const tripFuel = burnRate * duration;
  const reserveFuel = burnRate * 0.75;
  const plannedFuel = roundedFuelKg(tripFuel * 1.05 + reserveFuel);
  const capacity = Number(aircraft?.fuelCapacityKg);
  const recommendedFuel = Number.isFinite(capacity) && capacity > 0 ? Math.min(plannedFuel, Math.floor(capacity * 0.95)) : plannedFuel;
  const rawCurrentFuel = aircraft?.lastFuelKg;
  const currentFuel = Number(rawCurrentFuel);
  const hasCurrentFuel = rawCurrentFuel !== null && rawCurrentFuel !== undefined && rawCurrentFuel !== ""
    && Number.isFinite(currentFuel) && currentFuel >= 0;
  const margin = hasCurrentFuel ? currentFuel - recommendedFuel : null;
  return {
    aircraft,
    burnRate,
    tripFuel: roundedFuelKg(tripFuel),
    reserveFuel: roundedFuelKg(reserveFuel),
    recommendedFuel,
    currentFuel: hasCurrentFuel ? currentFuel : null,
    currentPercent: hasCurrentFuel && Number.isFinite(capacity) && capacity > 0 ? Math.round(currentFuel / capacity * 100) : null,
    status: margin === null ? "等待 MSFS 校验" : margin >= 0 ? `余量 ${formatFuel(margin)}` : `还需 ${formatFuel(Math.abs(margin))}`,
    statusClass: margin === null ? "is-waiting" : margin >= 0 ? "is-ready" : "is-low"
  };
}

function missionActionHtml(mission) {
  const accepted = mission.status === "accepted";
  const done = mission.status === "completed";
  const anotherAcceptedMission = !accepted && state.missions.some((item) => item.status === "accepted");
  if (done) return `<button class="ghost-btn" disabled type="button">已完成</button>`;
  if (accepted) {
    return `<button class="ghost-btn" disabled type="button">${mission.verification?.phaseLabel || "等待模拟器飞行"}</button><button class="primary-btn" data-action="manual-complete-mission" data-id="${mission.id}" type="button"><i data-lucide="circle-check-big"></i><span>手动完成</span></button>`;
  }
  if (anotherAcceptedMission) return `<button class="primary-btn" disabled type="button">已有执行中任务</button>`;
  return `<button class="primary-btn" data-action="accept-mission" data-id="${mission.id}" type="button">接受任务</button>`;
}

function renderMissionListItem(mission) {
  const accepted = mission.status === "accepted";
  const done = mission.status === "completed";
  const isAssessment = mission.kind === "license-assessment";
  const scene = missionScene(mission);
  const linkedScene = isPackagedScene(scene);
  const codes = routeAirportCodes(mission);
  const originCode = String(mission.origin || codes[0] || state.pilot.base || "----").toUpperCase();
  const destinationCode = String(mission.destination || codes[1] || "现场").toUpperCase();
  const originAirport = airportByIcao(originCode);
  const destinationAirport = airportByIcao(destinationCode);
  const originName = originAirport?.name || originCode;
  const destinationName = destinationAirport?.name || (linkedScene ? `${scene.label || "任务现场"} · ${String(mission.site?.bearing || 0).padStart(3, "0")}°` : destinationCode);
  const fuel = missionFuelPlan(mission);
  const statusClass = done ? "is-completed" : accepted ? "is-active" : "is-open";
  const briefing = isAssessment
    ? mission.assessmentBrief || `完成 ${mission.aircraftHint} 的起飞、航段和落地考核。`
    : linkedScene ? scene.objective : mission.summary;
  const verification = mission.verification;
  return `<article class="mission-list-item ${statusClass} ${isAssessment ? "is-assessment" : ""}">
    <div class="mission-list-main">
      <div class="mission-route-lockup">
        <span>${escapeHtml(mission.category)} · ${escapeHtml(mission.subtype)}</span>
        <h3><b>${escapeHtml(originCode)}</b><i data-lucide="arrow-right"></i><b>${escapeHtml(destinationCode)}</b></h3>
        <p>${escapeHtml(originName)} → ${escapeHtml(destinationName)}</p>
      </div>
      <div class="mission-list-summary">
        <strong>${escapeHtml(formatTaskRouteLabel(mission.route))}</strong>
        <span>${formatTaskDistanceNm(mission.distance)} · ${formatHours(mission.duration)} · ${escapeHtml(mission.dispatchPhase || "日间")}</span>
      </div>
      <div class="mission-list-status ${statusClass}"><span></span><b>${statusText(mission.status)}</b><small>${escapeHtml(mission.risk)}风险</small></div>
      <div class="mission-list-actions">
        ${missionActionHtml(mission)}
        <button class="icon-btn danger-btn" data-action="delete-mission" data-id="${mission.id}" type="button" aria-label="删除任务" title="删除任务"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
    <div class="mission-briefing-grid">
      <section class="mission-briefing-block">
        <h4><i data-lucide="clipboard-list"></i>任务简报</h4>
        <p>${escapeHtml(briefing)}</p>
        <dl class="mission-briefing-facts">
          <div><dt>机型</dt><dd>${isFreeMode() ? "不限机型" : escapeHtml(mission.aircraftHint || "待指定")}</dd></div>
          <div><dt>${isAssessment ? "结果" : "收益"}</dt><dd>${isAssessment ? "完成后取得执照" : `${formatMoney(mission.payout)} · 声望 +${mission.repGain}`}</dd></div>
          <div><dt>天气</dt><dd>${escapeHtml(mission.weather || "实时天气")}</dd></div>
        </dl>
      </section>
      <section class="mission-briefing-block mission-weather-block">
        <h4><i data-lucide="cloud-sun"></i>METAR</h4>
        ${missionMetarLine(originCode, "起飞", mission.weather)}
        ${missionMetarLine(mission.destination || codes[1], "到达", mission.weather)}
      </section>
      <section class="mission-briefing-block mission-fuel-block">
        <h4><i data-lucide="fuel"></i>燃油计划</h4>
        <div class="mission-fuel-readout">
          <div><span>建议起飞</span><strong>${formatFuel(fuel.recommendedFuel)}</strong></div>
          <div><span>当前油量</span><strong>${fuel.currentFuel === null ? "等待同步" : formatFuel(fuel.currentFuel)}</strong>${fuel.currentPercent === null ? "" : `<small>${fuel.currentPercent}%</small>`}</div>
        </div>
        <p class="mission-fuel-status ${fuel.statusClass}">${fuel.status}</p>
        <small>航段 ${formatFuel(fuel.tripFuel)} + 45 分钟储备 ${formatFuel(fuel.reserveFuel)} · 估算耗油 ${formatFuel(fuel.burnRate)}/小时</small>
      </section>
    </div>
    ${accepted ? `<div class="mission-list-progress"><i data-lucide="radio"></i><span>${escapeHtml(verification?.detail || "正在等待模拟器数据")}</span><b>实际航迹 ${Math.round(verification?.flightDistanceNm || 0)} nm</b></div>` : ""}
  </article>`;
}

function renderMissionCard(mission) {
  const accepted = mission.status === "accepted";
  const done = mission.status === "completed";
  const isAssessment = mission.kind === "license-assessment";
  const scene = missionScene(mission);
  const linkedScene = isPackagedScene(scene);
  const verification = mission.verification;
  const sceneState = done ? "已落地，任务完成" : accepted ? verification?.phaseLabel || "等待正确机场起飞" : linkedScene ? "场景任务待启动" : "待起飞";
  const sceneDetail = linkedScene ? `${scene.objectTitle} · ${scene.objective}` : `${scene.label} · ${scene.objective}`;
  const sceneRuntime = {
    waiting: { label: "接近目标后生成", className: "warn" },
    connecting: { label: "正在连接场景桥", className: "warn" },
    creating: { label: "正在生成对象", className: "info" },
    created: { label: "对象已在 MSFS 生成", className: "good" },
    error: { label: "对象生成失败", className: "bad" }
  }[verification?.sceneState];
  const actionHtml = missionActionHtml(mission);
  return `
    <article class="mission-card ${accepted ? "active" : ""} ${done ? "completed" : ""} ${isAssessment ? "license-assessment-card" : ""}">
      <div class="mission-head">
        <div>
          <h3>${mission.title}</h3>
          <p>${mission.summary}</p>
        </div>
        <span class="tag ${mission.status === "completed" ? "good" : accepted ? "info" : "warn"}">${statusText(mission.status)}</span>
      </div>
      <div class="mission-animation ${accepted ? "is-flying" : done ? "is-completed" : "is-open"} ${linkedScene ? "scene-linked" : ""}" aria-label="任务状态动画">
        <div class="mission-animation-icon"><i data-lucide="${scene.icon}"></i></div>
        <div class="mission-flight-track" aria-hidden="true">
          <span class="flight-dot start"></span>
          <span class="flight-line"></span>
          <span class="flight-plane"><i data-lucide="plane"></i></span>
          <span class="flight-line"></span>
          <span class="flight-dot end"></span>
        </div>
        <div class="mission-animation-copy">
          <strong>${sceneState}</strong>
          <span>${sceneDetail}</span>
        </div>
      </div>
      ${linkedScene ? `<div class="scene-briefing">
        <p><i data-lucide="crosshair"></i><span>现场目标：${scene.objective}</span></p>
        <div class="tag-row">
          ${accepted && sceneRuntime ? `<span class="tag ${sceneRuntime.className}" title="${escapeHtml(verification?.sceneDetail || "")}">${sceneRuntime.label}</span>` : ""}
          <span class="tag ${missionTerrainType(mission) === "water" ? "info" : "good"}"><i data-lucide="${missionTerrainType(mission) === "water" ? "waves" : "mountain"}"></i>${missionTerrainLabel(mission)}</span>
          <span class="tag">${scene.animated ? `自动动画 ${scene.seconds}s` : "静态场景"}</span>
          ${accepted && verification?.flightPlanState ? `<span class="tag ${["loaded", "prepared"].includes(verification.flightPlanState) ? "good" : verification.flightPlanState === "error" ? "bad" : "warn"}">MSFS 航路 ${verification.flightPlanState === "loaded" ? "已加载" : verification.flightPlanState === "prepared" ? "已生成" : verification.flightPlanState === "error" ? "失败" : "处理中"}</span>` : ""}
          <span class="tag">目标区 ${scene.radiusNm} nm</span>
          <span class="tag">${missionArrivalLabel(mission)}</span>
          ${mission.site ? `<span class="tag">基地 ${mission.site.base} · ${formatTaskDistanceNm(mission.site.distanceNm)} · ${String(mission.site.bearing).padStart(3, "0")}°</span>` : ""}
          ${mission.site?.lat != null ? `<span class="tag scene-coordinate">${mission.site.lat.toFixed(5)}, ${mission.site.lon.toFixed(5)}</span>` : ""}
        </div>
        ${accepted && verification?.sceneDetail ? `<p class="scene-runtime-note is-${verification.sceneState || "waiting"}"><i data-lucide="${verification.sceneState === "created" ? "circle-check" : verification.sceneState === "error" ? "triangle-alert" : "loader-circle"}"></i><span>${escapeHtml(verification.sceneDetail)}</span></p>` : ""}
        ${accepted && verification?.flightPlanDetail ? `<p class="scene-runtime-note is-${verification.flightPlanState || "waiting"}"><i data-lucide="route"></i><span>${escapeHtml(verification.flightPlanDetail)}</span></p>` : ""}
      </div>` : ""}
      <div class="tag-row">
        ${isAssessment ? `<span class="tag info"><i data-lucide="badge-check"></i>机型考核</span>` : ""}
        ${isEmergencyMission(mission) ? `<span class="tag bad">紧急任务</span>` : ""}
        <span class="tag">${mission.category}</span>
        ${mission.origin ? `<span class="tag info">基地 ${mission.origin}</span>` : ""}
        <span class="tag">${escapeHtml(formatTaskRouteLabel(mission.route))}</span>
        <span class="tag">${formatTaskDistanceNm(mission.distance)}</span>
        <span class="tag info">${mission.dispatchPhase || "日间"}任务</span>
        <span class="tag">${isFreeMode() ? "自由模式 · 不限机型" : `适配 ${escapeHtml(mission.aircraftHint || "待指定")}`}</span>
        <span class="tag">${formatHours(mission.duration)}</span>
        ${isAssessment ? `<span class="tag good">完成后取得执照</span>` : `<span class="tag">奖励 ${formatMoney(mission.payout)}</span><span class="tag">声望 +${mission.repGain}</span>`}
        <span class="tag">${mission.risk} 风险</span>
        ${accepted && !linkedScene && verification?.flightPlanState ? `<span class="tag ${["loaded", "prepared"].includes(verification.flightPlanState) ? "good" : verification.flightPlanState === "error" ? "bad" : "warn"}">MSFS 航路 ${verification.flightPlanState === "loaded" ? "已加载" : verification.flightPlanState === "prepared" ? "已生成" : verification.flightPlanState === "error" ? "失败" : "处理中"}</span>` : ""}
      </div>
      ${isAssessment ? `<p class="scene-runtime-note is-waiting"><i data-lucide="clipboard-check"></i><span>${escapeHtml(mission.assessmentBrief || `完成 ${mission.aircraftHint} 的起飞、航段和落地考核，任务完成后正式发证。`)}</span></p>` : ""}
      ${accepted ? `<div class="mission-verification"><span>${escapeHtml(verification?.detail || "正在等待模拟器数据")}</span><b>实际航迹 ${Math.round(verification?.flightDistanceNm || 0)} nm</b></div>` : ""}
      ${accepted && !linkedScene && verification?.flightPlanDetail ? `<p class="scene-runtime-note is-${verification.flightPlanState || "waiting"}"><i data-lucide="route"></i><span>${escapeHtml(verification.flightPlanDetail)}</span></p>` : ""}
      <div class="card-actions">
        ${actionHtml}
        <button class="ghost-btn danger-btn mission-delete-btn" data-action="delete-mission" data-id="${mission.id}" type="button"><i data-lucide="trash-2"></i><span>删除任务</span></button>
      </div>
    </article>`;
}

function statusText(status) {
  if (status === "accepted") return "已接受";
  if (status === "completed") return "已完成";
  return "待接单";
}

function visibleFlightLogs(logs) {
  const selected = [];
  const missionPositions = new Map();
  const sorted = Array.isArray(logs) ? logs.slice().sort((a, b) => Number(b.date) - Number(a.date)) : [];
  sorted.forEach((log) => {
    const missionId = String(log?.missionId || "").trim();
    if (!missionId) {
      selected.push(log);
      return;
    }
    if (!missionPositions.has(missionId)) {
      missionPositions.set(missionId, selected.length);
      selected.push(log);
      return;
    }
    const position = missionPositions.get(missionId);
    const current = selected[position];
    const isSettled = Number(log?.settledAt) > 0 || log?.source === "mission";
    const currentIsSettled = Number(current?.settledAt) > 0 || current?.source === "mission";
    if (isSettled && !currentIsSettled) selected[position] = log;
  });
  return selected.sort((a, b) => Number(b.date) - Number(a.date));
}

function renderLogs() {
  const logs = visibleFlightLogs(state.logs);
  els.recentLogs.innerHTML = logs.slice(0, 3).map(renderLogCard).join("") || emptyCard("还没有飞行日志。");
  els.logsList.innerHTML = logs.map(renderLogCard).join("") || emptyCard("先完成一段飞行，日志会自动出现。");
  const events = uniqueTaskEvents(state.taskEvents).sort((a, b) => b.date - a.date);
  const activeMission = activeVerifiedMission();
  const liveProgress = activeMission ? renderLiveTaskProgress(activeMission) : "";
  const latestEvent = events.slice(0, 1).map(renderTaskEventCard).join("");
  els.sidebarLogs.innerHTML = liveProgress || latestEvent
    ? (liveProgress || latestEvent)
    : emptyCard("接受任务后会实时显示任务状态。");
}

function latestCompletedTaskLog() {
  const logs = visibleFlightLogs(state.logs);
  return logs
    .filter((log) => {
      if (!log?.missionId || log.status === "crashed") return false;
      const mission = state.missions.find((item) => item.id === log.missionId);
      return mission?.status === "completed"
        || Number(log.settledAt) > 0
        || log.source === "mission";
    })
    .sort((a, b) => Number(b.settledAt || b.date || 0) - Number(a.settledAt || a.date || 0))[0] || null;
}

function formatNullable(value, suffix = "") {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
    ? "暂无数据"
    : `${value}${suffix}`;
}

function renderSopReport(report, { compact = false } = {}) {
  if (!report) return "";
  const stages = Array.isArray(report.stages) ? report.stages : [];
  const deductions = Array.isArray(report.deductions) ? report.deductions : [];
  const landing = report.landing || {};
  const statusClass = (stage) => stage.status === "通过" ? "good" : stage.status === "有扣分" ? "warn" : "muted";
  return `
    <details class="sop-report" ${compact ? "" : "open"}>
      <summary><span>SOP 详细报告</span><strong>${Math.round(Number(report.score ?? 100))}/100</strong></summary>
      <div class="sop-report-body">
        <div class="sop-stage-grid">
          ${stages.map((stage) => `<div class="sop-stage-row"><span>${escapeHtml(stage.name)} <small>${stage.points}分</small></span><span class="tag ${statusClass(stage)}">${escapeHtml(stage.status)}</span></div>`).join("")}
        </div>
        <div class="sop-report-section">
          <strong>操作错误与扣分</strong>
          ${deductions.length
            ? `<ul class="sop-deduction-list">${deductions.map((item) => `<li><span>${escapeHtml(item.title || "SOP 违规")}</span><b>-${Number(item.points || 0).toFixed(Number(item.points) % 1 ? 1 : 0)}分</b><small>${escapeHtml(item.detail || "")}</small></li>`).join("")}</ul>`
            : `<p class="sop-report-muted">未记录操作错误。</p>`}
        </div>
        <div class="sop-report-section">
          <strong>接地数据</strong>
          <div class="sop-landing-grid">
            <span>接地率 <b>${formatNullable(landing.landingRateFpm, " fpm")}</b></span>
            <span>峰值 G <b>${formatNullable(landing.peakG, " G")}</b></span>
            <span>接地速度 <b>${formatNullable(landing.touchdownSpeedKt, " kt")}</b></span>
            <span>接地姿态 <b>${landing.touchdownPitchDeg == null ? "暂无数据" : `${Number(landing.touchdownPitchDeg).toFixed(1)}° 俯仰 / ${Number(landing.touchdownBankDeg || 0).toFixed(1)}° 横滚`}</b></span>
            <span>机场 / 跑道 <b>${escapeHtml([landing.airport, landing.runway].filter(Boolean).join(" / ") || "暂无数据")}</b></span>
            <span>机况损耗 <b>${formatNullable(landing.wearPercent, "%")}</b></span>
            <span>弹跳次数 <b>${formatNullable(landing.bounceCount)}</b></span>
            <span>数据来源 <b>${escapeHtml(landing.rateSource || landing.rateConfidence || "暂无数据")}</b></span>
          </div>
        </div>
        ${Array.isArray(report.dataUnavailable) && report.dataUnavailable.length ? `<p class="sop-report-muted">${escapeHtml(report.dataUnavailable.join("、"))}暂无遥测数据，未因缺失数据扣分。</p>` : ""}
      </div>
    </details>`;
}

function renderDashboardSettlement() {
  if (!els.dashboardSettlement) return;
  const log = latestCompletedTaskLog();
  if (!log) {
    els.dashboardSettlement.innerHTML = `
      <div class="settlement-empty">
        <i data-lucide="clipboard-list" aria-hidden="true"></i>
        <strong>暂无已完成任务</strong>
        <span>完成任务后，这里会显示最近一次飞行结算。</span>
      </div>`;
    return;
  }
  const fuelUsed = Number(log.taskFuelUsedKg) > 0 ? log.taskFuelUsedKg : log.fuelUsedKg;
  const income = Number(log.income);
  const grossIncome = Number(log.grossIncome);
  const hasGrossIncome = Number.isFinite(grossIncome) && grossIncome !== 0 && grossIncome !== income;
  const settledAt = Number(log.settledAt || log.date);
  els.dashboardSettlement.innerHTML = `
    <div class="settlement-head">
      <div>
        <p class="settlement-eyebrow">最近任务结算</p>
        <h3>${escapeHtml(log.taskTitle || `${log.from || "未知"} → ${log.to || "未知"}`)}</h3>
      </div>
      <span class="tag good">已完成</span>
    </div>
    <p class="settlement-route">${escapeHtml(log.from || "未知起飞点")} → ${escapeHtml(log.to || "未知落地点")}</p>
    <div class="settlement-grid">
      <div><span>飞行时间</span><strong>${formatHours(log.hours)}</strong></div>
      <div><span>飞行距离</span><strong>${formatDistanceNm(log.miles)}</strong></div>
      <div><span>消耗燃油</span><strong>${formatFuel(fuelUsed)}</strong></div>
      <div><span>${hasGrossIncome ? "任务收入" : "收入"}</span><strong>${formatMoney(hasGrossIncome ? grossIncome : income)}</strong></div>
      <div><span>净收入</span><strong class="is-income">${formatMoney(income)}</strong></div>
    </div>
    ${log.sopEnabled ? `<p class="settlement-meta">SOP 得分 ${Math.round(Number(log.sopScore ?? 100))}/100 · 奖励折算 ${Math.round(Number(log.sopMultiplier ?? 1) * 100)}%</p>` : ""}
    <p class="settlement-meta">${Number.isFinite(settledAt) && settledAt > 0 ? `结算于 ${new Date(settledAt).toLocaleString("zh-CN")}` : "已完成任务"}</p>`;
}

function renderLiveTaskProgress(mission) {
  const verification = mission?.verification || {};
  const sop = verification.sop;
  const sopDataHint = sop?.enabled && sop.dataUnavailable?.length
    ? ` · ${sop.dataUnavailable.join("、")}暂无遥测数据`
    : "";
  const timestamp = Date.parse(verification.lastTelemetryTimestamp || "");
  const updatedAt = Number.isFinite(timestamp) ? timestamp : Date.now();
  const distance = Math.max(0, Number(verification.flightDistanceNm || 0));
  return `
    <article class="task-event-card is-live">
      <div class="task-event-head">
        <strong><span class="task-live-dot" aria-hidden="true"></span>${escapeHtml(verification.phaseLabel || "任务进行中")}</strong>
        <time>${new Date(updatedAt).toLocaleTimeString("zh-CN")}</time>
      </div>
      <p class="task-event-mission">${escapeHtml(mission.title || "当前任务")}</p>
      <p>${escapeHtml(`${verification.detail || "正在等待 MSFS 实时遥测"}${sopDataHint}`)}</p>
      <div class="task-progress-meta"><span>实际航迹 ${Math.round(distance)} nm</span>${sop?.enabled ? `<span>SOP ${Math.round(Number(sop.score ?? 100))}/100</span>` : ""}<span>实时更新</span></div>
    </article>`;
}

function renderTaskEventCard(event) {
  return `
    <article class="task-event-card">
      <div class="task-event-head">
        <strong>${escapeHtml(event.title || "任务状态更新")}</strong>
        <time>${new Date(event.date).toLocaleTimeString("zh-CN")}</time>
      </div>
      ${event.missionTitle ? `<p class="task-event-mission">${escapeHtml(event.missionTitle)}</p>` : ""}
      <p>${escapeHtml(event.detail || "")}</p>
    </article>`;
}

function renderLogCard(log) {
  const isMsfs = log.source === "msfs";
  const landingRate = Number(log.landingRateFpm);
  const landingPeakG = Number(log.landingPeakG);
  return `
    <article class="log-card">
      <div class="log-head">
        <div>
          <h3>${escapeHtml(log.from || "未知起飞点")} → ${escapeHtml(log.to || "未知落地点")}</h3>
          <p>${escapeHtml(log.aircraftName || "未知机型")}</p>
        </div>
        <span class="tag ${isMsfs ? "info" : "good"}">${isMsfs ? "MSFS 实际" : formatMoney(log.income)}</span>
      </div>
      ${log.taskTitle ? `<div class="tag-row"><span class="tag info">任务 ${escapeHtml(log.taskTitle)}</span></div>` : ""}
      <div class="log-line">
        <span>${new Date(log.date).toLocaleString("zh-CN")}</span>
        <span>${formatHours(Number(log.hours) || 0)} · ${Number(log.miles || 0).toFixed(1)} nm</span>
      </div>
      ${isMsfs && Number.isFinite(landingRate) && landingRate > 0 ? `<div class="log-line"><span>接地率 ${landingRate.toFixed(0)} fpm${Number.isFinite(landingPeakG) ? ` · ${landingPeakG.toFixed(2)} G` : ""}</span><span>机况损耗 ${Number(log.landingWearPercent || 0).toFixed(0)}%</span></div>` : ""}
      ${Number(log.fuelUsedKg) > 0 ? `<div class="log-line"><span>MSFS 实际燃油 ${formatFuel(log.fuelUsedKg)}</span><span>成本 ${formatMoney(Number(log.fuelCost) || 0)}</span></div>` : ""}
      ${isMsfs && Number(log.taskFuelUsedKg) > 0 ? `<div class="log-line"><span>任务累计燃油 ${formatFuel(log.taskFuelUsedKg)}</span><span>成本 ${formatMoney(Number(log.taskFuelCost) || 0)}</span></div>` : ""}
      ${isMsfs && log.settledAt ? `<div class="log-line"><span>任务净收入</span><span>${formatMoney(log.income)}</span></div>` : ""}
      ${log.sopEnabled ? `<div class="log-line"><span>SOP 得分</span><span>${Math.round(Number(log.sopScore ?? 100))}/100 · 奖励折算 ${Math.round(Number(log.sopMultiplier ?? 1) * 100)}%</span></div>` : ""}
      ${log.sopEnabled ? renderSopReport(log.sopReport, { compact: true }) : ""}
      ${log.notes ? `<p>${escapeHtml(log.notes)}</p>` : ""}
    </article>`;
}

function renderHangar() {
  const families = [...new Set(aircraftCatalog.map(aircraftManufacturerFamily))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const current = families.includes(state.hangarFilter) ? state.hangarFilter : "all";
  const query = String(state.hangarSearch || "").trim().toUpperCase();
  state.hangarFilter = current;
  els.hangarFilter.innerHTML = `<option value="all">全部制造商</option>${families.map((family) => `<option value="${escapeHtml(family)}">${escapeHtml(family)}</option>`).join("")}`;
  els.hangarFilter.value = current;
  els.hangarSearch.value = state.hangarSearch || "";
  const visibleFleet = aircraftCatalog.filter((aircraft) => {
    const matchesFamily = current === "all" || aircraftManufacturerFamily(aircraft) === current;
    const searchable = `${aircraft.name} ${aircraftManufacturerFamily(aircraft)} ${aircraft.kind} ${aircraft.pace} ${aircraft.note}`.toUpperCase();
    return matchesFamily && (!query || searchable.includes(query));
  });
  els.hangarGrid.innerHTML = visibleFleet.map(renderAircraftCard).join("") || emptyCard("没有符合条件的机型。");
}

function renderAircraftCard(aircraft) {
  const unlockable = isFreeMode() || state.stats.totalHours >= aircraft.unlockHours;
  const managedCount = state.fleet.filter((item) => !isCompanyAircraft(item)
    && (item.owned || item.rented)
    && (item.catalogId || item.id) === aircraft.id).length;
  const actions = [
    `<button class="primary-btn" data-action="buy-aircraft" data-id="${aircraft.id}" type="button" ${unlockable ? "" : "disabled"}><i data-lucide="shopping-cart"></i><span>购买</span></button>`,
    `<button class="ghost-btn" data-action="rent-aircraft" data-id="${aircraft.id}" type="button" ${unlockable ? "" : "disabled"}><i data-lucide="calendar-plus"></i><span>租赁</span></button>`
  ];
  return `
    <article class="hangar-card">
      <div class="hangar-head">
        <div>
          <h3>${escapeHtml(aircraft.name)}</h3>
          <p>${escapeHtml(aircraftManufacturerFamily(aircraft))} · ${escapeHtml(aircraft.kind)}</p>
        </div>
        <span class="tag ${unlockable ? "good" : "warn"}">${isFreeMode() ? "自由模式" : unlockable ? "已解锁" : `需 ${aircraft.unlockHours} 小时`}</span>
      </div>
      <div class="tag-row">
        <span class="tag">${escapeHtml(aircraft.pace)}</span>
        <span class="tag">航程 ${aircraft.range} nm</span>
        <span class="tag good">在售 · 可重复购买/租赁</span>
        ${managedCount ? `<span class="tag info">个人机队已有 ${managedCount} 架</span>` : ""}
      </div>
      <p>${escapeHtml(aircraft.note)}</p>
      <div class="tag-row">
        <span class="tag">购买 ${formatMoney(aircraft.price)}</span>
        <span class="tag">租金 ${formatMoney(aircraft.rent)}</span>
      </div>
      <div class="card-actions">${actions.join("")}</div>
    </article>`;
}

function renderAircraftManagement() {
  const allManagedFleet = state.fleet.filter((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented));
  const families = [...new Set(allManagedFleet.map(aircraftManufacturerFamily))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const currentFilter = families.includes(state.aircraftManagementFilter) ? state.aircraftManagementFilter : "all";
  const query = String(state.aircraftManagementSearch || "").trim().toUpperCase();
  state.aircraftManagementFilter = currentFilter;
  if (els.aircraftManagementFilter) {
    els.aircraftManagementFilter.innerHTML = `<option value="all">全部制造商</option>${families.map((family) => `<option value="${escapeHtml(family)}">${escapeHtml(family)}</option>`).join("")}`;
    els.aircraftManagementFilter.value = currentFilter;
  }
  if (els.aircraftManagementSearch) els.aircraftManagementSearch.value = state.aircraftManagementSearch || "";
  const managedFleet = allManagedFleet.filter((aircraft) => {
    const matchesFamily = currentFilter === "all" || aircraftManufacturerFamily(aircraft) === currentFilter;
    const searchable = `${aircraft.name} ${aircraftManufacturerFamily(aircraft)} ${aircraft.kind} ${aircraftFleetNumber(aircraft)} ${aircraft.catalogId || ""}`.toUpperCase();
    return matchesFamily && (!query || searchable.includes(query));
  });
  const liveAircraft = lastTelemetryConnected ? telemetryFleetAircraft(lastTelemetry) : null;
  const liveFuel = liveAircraft ? telemetryFuelKg(lastTelemetry) : null;
  els.aircraftManagementSummary.innerHTML = `
    <div class="hangar-summary-item">
      <span>机队规模</span>
      <strong>${managedFleet.length} 架</strong>
      <small>购买 ${managedFleet.filter((aircraft) => aircraft.owned).length} · 租用 ${managedFleet.filter((aircraft) => aircraft.rented).length}</small>
    </div>
    <div class="hangar-summary-item">
      <span>当前任务机型</span>
      <strong>${escapeHtml(currentAircraft().name)}</strong>
      <small>${getAircraftHours(currentAircraft().id).toFixed(1)} 小时运营记录</small>
    </div>
    <div class="hangar-summary-item ${liveFuel !== null ? "is-live" : ""}">
      <span>MSFS 实际燃油</span>
      <strong>${liveFuel !== null ? formatFuel(liveFuel) : "等待遥测"}</strong>
      <small>${liveAircraft ? escapeHtml(liveAircraft.name) : "连接后自动匹配机型"}</small>
    </div>
    <div class="hangar-summary-item">
      <span>累计实际消耗</span>
      <strong>${formatFuel(state.stats.totalFuelKg)}</strong>
      <small>燃油成本 ${formatMoney(Math.round(state.stats.totalFuelCost))}</small>
    </div>`;
  els.aircraftManagementGrid.innerHTML = managedFleet.map((aircraft) => renderManagedAircraftCard(aircraft)).join("")
    || emptyCard("当前没有已购买或租用的飞机。");
}

function renderManagedAircraftCard(aircraft, controlPrefix = "") {
  const selected = aircraft.selected;
  const liveInMsfs = lastTelemetryConnected && telemetryFleetAircraft(lastTelemetry)?.id === aircraft.id;
  const logs = state.logs.filter((log) => log.aircraftId === aircraft.id);
  const fuelUsedKg = logs.reduce((sum, log) => sum + Math.max(0, Number(log.fuelUsedKg) || 0), 0);
  const fuelKg = liveInMsfs ? telemetryFuelKg(lastTelemetry) : aircraft.lastFuelKg;
  const capacityKg = liveInMsfs ? telemetryFuelCapacityKg(lastTelemetry) || aircraft.fuelCapacityKg : aircraft.fuelCapacityKg;
  const currentFuelPercent = fuelKg !== null && Number(capacityKg) > 0
    ? Math.max(0, Math.min(100, Number(fuelKg) / Number(capacityKg) * 100))
    : null;
  const sliderState = fuelSliderState(
    currentFuelPercent,
    fuelTargetPercents.get(aircraft.id),
    fuelTargetBaselines.get(aircraft.id)
  );
  const minimumFuelPercent = sliderState.minimumPercent;
  const targetFuelPercent = sliderState.targetPercent;
  const controlId = controlPrefix ? `${controlPrefix}-${aircraft.id}` : aircraft.id;
  if (fuelTargetPercents.has(aircraft.id) && !sliderState.usesRequestedTarget) {
    fuelTargetPercents.delete(aircraft.id);
    fuelTargetBaselines.delete(aircraft.id);
  }
  const onGround = liveInMsfs && telemetryBoolean(lastTelemetry?.onGround);
  const engineRunning = liveInMsfs && telemetryBoolean(lastTelemetry?.engineRunning);
  const canUseFuelSlider = liveInMsfs && onGround && !engineRunning && Number(capacityKg) > 0;
  const refuelPending = refuelPendingIds.has(aircraft.id);
  const refuelBlockedReason = !liveInMsfs
    ? "请先在 MSFS 切换到此机型"
    : !onGround ? "飞机必须停在地面"
    : engineRunning ? "请先关闭发动机"
    : !(Number(capacityKg) > 0) ? "等待 MSFS 返回油箱容量"
    : "";
  const condition = aircraftCondition(aircraft);
  const conditionLevel = aircraftConditionLevel(aircraft);
  const maintenanceCost = aircraftMaintenanceCost(aircraft);
  const landingRate = Number(aircraft.lastLandingRateFpm);
  const landingPeakG = Number(aircraft.lastLandingPeakG);
  const hasLandingData = Number.isFinite(landingRate) && landingRate > 0;
  const landingLocation = [aircraft.lastLandingAirport, aircraft.lastLandingRunway].filter(Boolean).join(" ");
  const landingConditionDetail = hasLandingData
    ? `最近落地 ${landingRate.toFixed(0)} fpm${Number.isFinite(landingPeakG) ? ` · ${landingPeakG.toFixed(2)} G` : ""} · 损耗 ${Number(aircraft.lastLandingWearPercent || 0).toFixed(0)}%${landingLocation ? ` · ${escapeHtml(landingLocation)}` : ""}`
    : "等待 MSFS 落地数据";
  const maintenanceBlocked = aircraftHasActiveMission(aircraft);
  const actions = isCompanyAircraft(aircraft)
    ? [`<button class="primary-btn" type="button" disabled>公司机型</button>`]
    : [`<button class="primary-btn" data-action="select-aircraft" data-id="${aircraft.id}" type="button">${selected ? "当前机型" : "设为默认"}</button>`];
  actions.push(`<button class="ghost-btn" data-action="refuel-aircraft" data-id="${aircraft.id}" data-control-prefix="${escapeHtml(controlPrefix)}" type="button" ${!canUseFuelSlider || targetFuelPercent <= minimumFuelPercent || refuelPending ? "disabled" : ""} title="${escapeHtml(refuelBlockedReason || "将 MSFS 实际油量加注到目标值")}"><i data-lucide="fuel"></i><span>${refuelPending ? "加注中" : "确认加注"}</span></button>`);
  actions.push(`<button class="ghost-btn" data-action="repair-aircraft" data-id="${aircraft.id}" type="button" ${maintenanceCost <= 0 || maintenanceBlocked ? "disabled" : ""} title="${maintenanceBlocked ? "执行任务期间不能维修" : maintenanceCost <= 0 ? "飞机状态良好" : `维修费用 ${formatMoney(maintenanceCost)}`}"><i data-lucide="wrench"></i><span>维修${maintenanceCost > 0 ? ` ${formatMoney(maintenanceCost)}` : ""}</span></button>`);
  if (aircraft.rented) actions.push(`<button class="ghost-btn" data-action="return-aircraft" data-id="${aircraft.id}" type="button">归还</button>`);
  if (aircraft.owned && (!isStarterAircraft(aircraft.id) || isCompanyAircraft(aircraft))) actions.push(`<button class="ghost-btn" data-action="sell-aircraft" data-id="${aircraft.id}" type="button">出售</button>`);
  return `
    <article class="hangar-card ${selected ? "is-current" : ""} ${liveInMsfs ? "is-msfs-live" : ""}">
      <div class="hangar-head">
        <div>
          <h3>${escapeHtml(aircraft.name)}</h3>
          <p>${escapeHtml(aircraftManufacturerFamily(aircraft))} · ${escapeHtml(aircraft.kind)} · ${isCompanyAircraft(aircraft) ? "公司配备" : aircraft.owned ? "已购买" : "已租用"} · 机队编号 ${aircraftFleetNumber(aircraft)}</p>
        </div>
        <div class="hangar-statuses">
          ${liveInMsfs ? `<span class="tag good">MSFS 当前机型</span>` : ""}
          ${selected ? `<span class="tag info">任务默认</span>` : ""}
          ${isCompanyAircraft(aircraft) ? `<span class="tag good">公司专属</span>` : ""}
        </div>
      </div>
      <div class="tag-row">
        <span class="tag">${escapeHtml(aircraft.pace)}</span>
        <span class="tag">航程 ${aircraft.range} nm</span>
        <span class="tag">${aircraft.owned ? `资产 ${formatMoney(aircraft.price)}` : `租金 ${formatMoney(aircraft.rent)}`}</span>
      </div>
      <div class="aircraft-ops">
        <div><span>飞行记录</span><strong>${logs.length} 航段</strong><small>${getAircraftHours(aircraft.id).toFixed(1)} 小时</small></div>
        <div><span>实际消耗</span><strong>${formatFuel(fuelUsedKg)}</strong><small>已结算任务累计</small></div>
        <div><span>最近实际油量</span><strong>${formatFuel(aircraft.lastFuelKg)}</strong><small>${formatFuelTimestamp(aircraft.lastFuelAt)}</small></div>
      </div>
      <div class="aircraft-service-grid">
        <div class="aircraft-service-control">
          <div class="aircraft-service-label">
            <span>加注燃油</span>
          <output id="fuelTarget-${controlId}" for="fuelSlider-${controlId}">${targetFuelPercent.toFixed(0)}%</output>
        </div>
          <input id="fuelSlider-${controlId}" class="fuel-slider" data-action="fuel-target" data-id="${aircraft.id}" data-control-prefix="${escapeHtml(controlPrefix)}" data-minimum="${minimumFuelPercent}" type="range" min="0" max="100" step="1" value="${targetFuelPercent}" aria-label="${escapeHtml(aircraft.name)} 加注燃油目标" ${canUseFuelSlider && !refuelPending ? "" : "disabled"}>
          <small>${canUseFuelSlider ? `当前 ${currentFuelPercent.toFixed(0)}% · ${formatFuel(fuelKg)} / ${formatFuel(capacityKg)}` : refuelBlockedReason}</small>
        </div>
        <div class="aircraft-service-control">
          <div class="aircraft-service-label"><span>飞机机况</span><strong>${condition.toFixed(1)}%</strong></div>
          <div class="condition-meter ${conditionLevel.className}" role="meter" aria-label="${escapeHtml(aircraft.name)} 机况" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${condition}"><span style="width:${condition}%"></span></div>
          <small>${conditionLevel.label} · ${landingConditionDetail}${maintenanceCost > 0 ? ` · 维修费用 ${formatMoney(maintenanceCost)}` : ""}</small>
        </div>
      </div>
      <div class="card-actions">${actions.join("")}</div>
    </article>`;
}

function companyPilotUpgradeCost(pilot) {
  return 4500 * Math.max(1, Number(pilot?.skillLevel) || 1);
}

function companyEmpty(message = "请先在公司管理中创建航空公司。") {
  return `<article class="company-empty"><i data-lucide="building-2"></i><strong>${message}</strong></article>`;
}

function setCompanySection(section) {
  if (!state.company) return;
  state.company.activeSection = ["management", "tasks", "pilots", "recruitment", "hangar", "finance", "flight-log"].includes(section) ? section : "management";
  renderCompanyManagement();
  saveState();
  wireIcons();
}

function renderCompanyManagement() {
  const company = state.company;
  const created = company?.created === true;
  const section = company?.activeSection || "management";
  document.querySelectorAll("[data-company-section]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.companySection === section);
  });
  document.querySelectorAll("[data-company-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.companyPanel === section);
  });
  if (!created) {
    els.companyIdentity.innerHTML = `<span class="tag warn">尚未创建公司</span>`;
    els.companyManagementPanel.innerHTML = `
      <section class="panel company-create-panel">
        <div class="company-create-copy">
          <span class="company-kicker">公司初始化</span>
          <h3>创建你的航空公司</h3>
          <p>输入航空公司三字码自动匹配公司名称，设置运营基地、初始飞机和启动资金。启动资金从个人账户转入公司账户。</p>
          <p class="company-requirement ${canCreateCompany() ? "is-ready" : ""}">${companyCreationRequirementText()}</p>
        </div>
        <div class="form-grid company-form-grid">
          <label class="field company-name-field"><span>公司名称（三字码）</span><input id="companyNameInput" type="text" inputmode="latin" minlength="3" maxlength="3" pattern="[A-Za-z]{3}" autocomplete="off" spellcheck="false" value="${escapeHtml(currentAirline().code)}" placeholder="输入三字码，例如 CCA"><output id="companyNameResult" class="company-airline-result"></output></label>
          <label class="field company-base-field"><span>公司基地</span><input id="companyBaseInput" type="text" inputmode="text" minlength="4" maxlength="4" pattern="[A-Za-z]{4}" autocomplete="off" spellcheck="false" value="${escapeHtml(normalizeAirportInputCode(state.pilot.base || "ZBAA"))}" placeholder="输入四字 ICAO"><output id="companyBaseResult" class="company-base-result"></output></label>
          <label class="field company-aircraft-field"><span>公司初始飞机</span><select id="companyAircraftSelect" class="select" aria-label="选择公司初始飞机">${aircraftCatalog.filter((aircraft) => aircraft.kind === "干线喷气").map((aircraft) => `<option value="${escapeHtml(aircraft.id)}">${escapeHtml(aircraft.name)} · ${escapeHtml(aircraft.pace)}</option>`).join("")}</select><small class="field-hint">创建后归公司所有，可在机库管理中维护。</small></label>
          <label class="field"><span>启动资金</span><input id="companyFundsInput" type="number" min="${COMPANY_STARTUP_FUNDS_MIN}" max="${COMPANY_STARTUP_FUNDS_MAX}" step="1000" value="${COMPANY_STARTUP_FUNDS_MIN}"><small class="field-hint">最多 ${formatMoney(COMPANY_STARTUP_FUNDS_MAX)}</small></label>
        </div>
        <div class="company-create-preview" id="companyCreatePreview"></div>
        <div class="card-actions"><button class="primary-btn" data-action="create-company" type="button" ${canCreateCompany() ? "" : "disabled"}><i data-lucide="building-2"></i><span>创建航空公司</span></button></div>
      </section>`;
    renderCompanyPlaceholderPanels();
    updateCompanyCreatePreview();
    return;
  }
  const airline = companyAirline();
  const base = companyBase();
  const pilots = company.pilots.filter((pilot) => pilot.status !== "fired");
  const managedFleet = companyManagedFleet();
  els.companyIdentity.innerHTML = `<div class="company-identity-main">${airlineLogo(airline, "airline-logo mini")}<strong>${escapeHtml(company.name || airline.name)}</strong><span>${airline.code}</span></div>`;
  els.companyManagementPanel.innerHTML = `
    <div class="company-overview-grid">
      <section class="panel company-profile-card">
        <div class="company-profile-head">
          ${airlineLogo(airline)}
          <div><h3>${escapeHtml(company.name || airline.name)}</h3><p>${escapeHtml(airline.name)} · ${escapeHtml(airline.type)}</p></div>
          <span class="tag good">运营中</span>
        </div>
        <div class="tag-row"><span class="tag">基地 ${escapeHtml(company.base)}</span><span class="tag">${escapeHtml(base?.name || "未知机场")}</span><span class="tag">${pilots.length} 名飞行员</span><span class="tag">${managedFleet.length} 架飞机</span></div>
        <div class="company-management-actions"><small>关闭公司会清除全部公司数据，个人飞机和个人飞行记录不受影响。</small><button class="action-btn danger" data-action="close-company" type="button"><i data-lucide="power"></i><span>关闭公司</span></button></div>
      </section>
      <section class="panel company-cash-card"><span>公司可用资金</span><strong>${formatMoney(company.funds)}</strong><small>独立于个人账户 · ${company.transactions.length} 条流水</small></section>
    </div>
    <div class="company-summary">
      <div><span>公司任务</span><strong>${company.tasks.length}</strong><small>已派遣任务</small></div>
      <div><span>在岗飞行员</span><strong>${pilots.filter((pilot) => pilot.status === "active").length}</strong><small>可接受派遣</small></div>
      <div><span>公司机库</span><strong>${managedFleet.length}</strong><small>含公司初始飞机</small></div>
      <div><span>合作航司</span><strong>${escapeHtml(airline.code)}</strong><small>${escapeHtml(airline.region)}</small></div>
    </div>`;
  renderCompanyTasks();
  renderCompanyPilots();
  renderCompanyApplicants();
  renderCompanyHangar();
  renderCompanyFinance();
  renderCompanyFlightLogs();
}

function renderCompanyPlaceholderPanels() {
  els.companyTaskList.innerHTML = companyEmpty();
  els.companyPilotSummary.innerHTML = "";
  els.companyPilotList.innerHTML = companyEmpty();
  els.companyApplicantList.innerHTML = companyEmpty();
  els.companyHangarSummary.innerHTML = "";
  els.companyHangarGrid.innerHTML = companyEmpty();
  els.companyFinanceSummary.innerHTML = "";
  els.companyTransactionList.innerHTML = `<p class="fund-empty">创建公司后显示公司资金流水。</p>`;
  els.companyFlightLogList.innerHTML = companyEmpty("创建公司后显示公司航班日志。");
}

function updateCompanyCreatePreview() {
  const preview = document.getElementById("companyCreatePreview");
  if (!preview) return;
  updateCompanyBasePreview();
  const input = document.getElementById("companyNameInput");
  const result = document.getElementById("companyNameResult");
  const code = normalizeAirlineCode(input?.value);
  if (input && input.value !== code) input.value = code;
  const airline = airlines.find((item) => item.code === code) || currentAirline();
  if (result) {
    result.textContent = code.length < 3 ? "请输入三字航空公司代码" : airlines.some((item) => item.code === code) ? `${airline.code} · ${airline.name}` : "未找到对应航空公司";
    result.classList.toggle("is-valid", code.length === 3 && airlines.some((item) => item.code === code));
    result.classList.toggle("is-invalid", code.length === 3 && !airlines.some((item) => item.code === code));
  }
  preview.innerHTML = `${airlineLogo(airline)}<div><strong>${escapeHtml(airline.name)}</strong><span>${escapeHtml(airline.code)} · ${escapeHtml(airline.region)} · ${escapeHtml(airline.type)}</span></div>`;
}

function updateCompanyBasePreview() {
  const input = document.getElementById("companyBaseInput");
  const result = document.getElementById("companyBaseResult");
  if (!input || !result) return;
  const code = normalizeAirportInputCode(input.value);
  if (input.value !== code) input.value = code;
  const airport = code.length === 4 ? companyAirportByIcao(code) : null;
  result.textContent = code.length < 4 ? "请输入四字 ICAO 代码" : companyAirportLabel(airport);
  result.classList.toggle("is-valid", Boolean(airport));
  result.classList.toggle("is-invalid", code.length === 4 && !airport);
}

function companyTaskSelection(missionId) {
  const pilotSelect = els.companyTaskList?.querySelector(`[data-company-pilot-for="${missionId}"]`);
  const aircraftSelect = els.companyTaskList?.querySelector(`[data-company-aircraft-for="${missionId}"]`);
  return { pilotId: String(pilotSelect?.value || ""), aircraftId: String(aircraftSelect?.value || "") };
}

function setCompanyTaskSelectOptions(select, items, selectedId, emptyLabel, renderOption) {
  if (!select) return "";
  const validSelectedId = items.some((item) => item.id === selectedId) ? selectedId : "";
  const options = items.map((item) => renderOption(item, item.id === validSelectedId)).join("");
  select.innerHTML = `<option value=""${items.length ? "" : " disabled"}>${escapeHtml(emptyLabel)}</option>${options}`;
  select.value = validSelectedId;
  return validSelectedId;
}

function updateCompanyTaskSelectors(row, changedBy = "") {
  if (!row) return;
  const pilotSelect = row.querySelector("[data-company-pilot-for]");
  const aircraftSelect = row.querySelector("[data-company-aircraft-for]");
  const dispatchButton = row.querySelector('[data-action="dispatch-company-task"]');
  if (!pilotSelect || !aircraftSelect) return;
  const pilots = state.company.pilots.filter((pilot) => pilot.status === "active");
  const aircraft = companyManagedFleet();
  let pilotId = String(pilotSelect.value || "");
  let aircraftId = String(aircraftSelect.value || "");
  let pilot = pilots.find((item) => item.id === pilotId);
  let plane = aircraft.find((item) => item.id === aircraftId);

  if (pilot && plane && !pilotCanOperateAircraft(pilot, plane)) {
    if (changedBy === "aircraft") {
      pilotId = "";
      pilot = null;
    } else {
      aircraftId = "";
      plane = null;
    }
  }

  const visibleAircraft = pilot ? aircraft.filter((item) => pilotCanOperateAircraft(pilot, item)) : aircraft;
  const visiblePilots = plane ? pilots.filter((item) => pilotCanOperateAircraft(item, plane)) : pilots;
  const pilotPlaceholder = pilots.length && !visiblePilots.length ? "无匹配飞行员" : "选择飞行员";
  const aircraftPlaceholder = aircraft.length && !visibleAircraft.length ? "无匹配飞机" : "选择飞机";
  pilotId = setCompanyTaskSelectOptions(
    pilotSelect,
    visiblePilots,
    pilotId,
    pilotPlaceholder,
    (item, selected) => `<option value="${escapeHtml(item.id)}"${selected ? " selected" : ""}${item.assignedTaskId ? " disabled" : ""}>${escapeHtml(item.name)} · 技能 ${item.skillLevel}</option>`
  );
  aircraftId = setCompanyTaskSelectOptions(
    aircraftSelect,
    visibleAircraft,
    aircraftId,
    aircraftPlaceholder,
    (item, selected) => `<option value="${escapeHtml(item.id)}"${selected ? " selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(item.kind)} · 编号 ${escapeHtml(aircraftFleetNumber(item))}</option>`
  );
  if (dispatchButton) dispatchButton.disabled = !pilotId || !aircraftId;
}

function renderCompanyTasks() {
  if (!state.company.created) return;
  if (!Array.isArray(state.company.taskOffers)) state.company.taskOffers = [];
  while (state.company.taskOffers.filter((offer) => offer.status === "open").length < COMPANY_TASK_OFFER_COUNT) {
    state.company.taskOffers.push(companyMissionOffer());
  }
  const pilots = state.company.pilots.filter((pilot) => pilot.status === "active");
  const aircraft = companyManagedFleet();
  const selections = new Map([...els.companyTaskList.querySelectorAll("[data-company-pilot-for]")].map((select) => {
    const missionId = select.dataset.companyPilotFor;
    return [missionId, { pilotId: select.value, aircraftId: els.companyTaskList.querySelector(`[data-company-aircraft-for="${missionId}"]`)?.value || "" }];
  }));
  const assigned = state.company.tasks.map((task) => {
    const pilot = state.company.pilots.find((item) => item.id === task.pilotId);
    const plane = state.fleet.find((item) => item.id === task.aircraftId);
    const flightLog = state.company.flightLogs?.find((log) => log.taskId === task.id);
    const resultLabel = task.status === "assigned" ? "已派遣" : companyFlightStatusLabel(flightLog?.status || task.status);
    return `<article class="company-row company-task-row"><div><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.origin)} → ${escapeHtml(task.destination)} · ${escapeHtml(resultLabel)} · ${escapeHtml(companyAirportCheckLabel(flightLog || task))}</p></div><div class="company-row-meta"><span class="tag info">${escapeHtml(pilot?.name || "未分配")}</span><span class="tag">${escapeHtml(plane?.name || "未分配飞机")} · 编号 ${escapeHtml(aircraftFleetNumber(plane))}</span>${task.status === "assigned" ? `<button class="ghost-btn" data-action="complete-company-task" data-id="${task.id}" type="button"><i data-lucide="circle-check"></i><span>完成派遣</span></button>` : `<span class="tag ${flightLog?.status === "airport-mismatch" ? "bad" : "good"}">收入 ${formatMoney(task.payout || 0)}</span>`}</div></article>`;
  }).join("");
  const available = state.company.taskOffers.filter((mission) => mission.status === "open");
  const availableHtml = available.map((mission) => `
    <article class="company-row company-task-row">
      <div><strong>${escapeHtml(mission.title)}</strong><p>${escapeHtml(mission.category)} · ${escapeHtml(mission.origin || state.company.base)} → ${escapeHtml(mission.destination || "任务现场")} · ${formatTaskDistanceNm(mission.distance)} · 奖励 ${formatMoney(mission.payout)}</p><small>建议机型：${escapeHtml(mission.aircraftHint || "公司机队可用机型")}</small></div>
      <div class="company-dispatch-controls" data-company-dispatch-for="${mission.id}">
        <select data-company-pilot-for="${mission.id}" aria-label="${escapeHtml(mission.title)} 派遣飞行员"><option value="">选择飞行员</option>${pilots.map((pilot) => `<option value="${escapeHtml(pilot.id)}"${selections.get(mission.id)?.pilotId === pilot.id ? " selected" : ""}${pilot.assignedTaskId ? " disabled" : ""}>${escapeHtml(pilot.name)} · 技能 ${pilot.skillLevel}</option>`).join("")}</select>
        <select data-company-aircraft-for="${mission.id}" aria-label="${escapeHtml(mission.title)} 派遣飞机"><option value="">选择飞机</option>${aircraft.map((plane) => `<option value="${escapeHtml(plane.id)}"${selections.get(mission.id)?.aircraftId === plane.id ? " selected" : ""}>${escapeHtml(plane.name)} · ${escapeHtml(plane.kind)} · 编号 ${escapeHtml(aircraftFleetNumber(plane))}</option>`).join("")}</select>
        <button class="primary-btn" data-action="dispatch-company-task" data-id="${mission.id}" type="button" ${!pilots.length || !aircraft.length ? "disabled" : ""}><i data-lucide="send"></i><span>派遣任务</span></button>
      </div>
    </article>`).join("");
  els.companyTaskList.innerHTML = `<div class="company-list-heading"><span>已派遣</span><small>${state.company.tasks.length} 条</small></div>${assigned || `<p class="company-muted">暂无已派遣任务。</p>`}<div class="company-list-heading"><span>可派遣任务</span><small>${available.length} 条</small></div>${availableHtml || `<p class="company-muted">暂无可派遣任务，请先刷新任务。</p>`}`;
  available.forEach((mission) => updateCompanyTaskSelectors(els.companyTaskList.querySelector(`[data-company-dispatch-for="${mission.id}"]`)));
}

function renderCompanyPilots() {
  if (!state.company.created) return;
  const pilots = state.company.pilots.filter((pilot) => pilot.status !== "fired");
  els.companyPilotSummary.innerHTML = `<div><span>在岗</span><strong>${pilots.filter((pilot) => pilot.status === "active").length}</strong><small>可派遣</small></div><div><span>平均技能</span><strong>${pilots.length ? Math.round(pilots.reduce((sum, pilot) => sum + Number(pilot.skill || 0), 0) / pilots.length) : 0}</strong><small>技能评分</small></div><div><span>月度薪资</span><strong>${formatMoney(pilots.reduce((sum, pilot) => sum + Number(pilot.salary || 0), 0))}</strong><small>预计支出</small></div>`;
  els.companyPilotList.innerHTML = pilots.map((pilot) => {
    const assigned = state.company.tasks.find((task) => task.id === pilot.assignedTaskId);
    const cost = companyPilotUpgradeCost(pilot);
    return `<article class="company-row company-pilot-row"><div class="pilot-avatar">${escapeHtml((pilot.name || "飞").slice(0, 1))}</div><div class="company-row-main"><strong>${escapeHtml(pilot.name)} ${pilot.owner ? "· 公司负责人" : ""}</strong><p>${escapeHtml(pilotAircraftKinds(pilot).join("、"))} · 技能等级 ${pilot.skillLevel} · 评分 ${pilot.skill} · ${pilot.experienceHours.toFixed(1)} 小时</p><small>${assigned ? `已派遣：${escapeHtml(assigned.title)}` : "当前空闲，可接受派遣"}</small></div><div class="card-actions company-inline-actions"><button class="ghost-btn" data-action="upgrade-company-pilot" data-id="${pilot.id}" type="button" ${pilot.skillLevel >= 5 || state.company.funds < cost ? "disabled" : ""}><i data-lucide="arrow-up-circle"></i><span>提升 ${formatMoney(cost)}</span></button><button class="ghost-btn danger-btn" data-action="fire-company-pilot" data-id="${pilot.id}" type="button" ${pilot.owner || assigned ? "disabled" : ""}>解雇</button><button class="text-btn" data-action="open-company-tasks" type="button">派遣任务</button></div></article>`;
  }).join("") || companyEmpty("还没有在岗飞行员，请先招聘。");
}

function renderCompanyApplicants() {
  if (!state.company.created) return;
  els.companyApplicantList.innerHTML = state.company.applicants.map((applicant) => `<article class="company-row company-applicant-row"><div class="pilot-avatar is-applicant">${escapeHtml((applicant.name || "候").slice(0, 1))}</div><div class="company-row-main"><strong>${escapeHtml(applicant.name)}</strong><p>技能等级 ${applicant.skillLevel} · 评分 ${applicant.skill} · 可操作 ${escapeHtml(normalizeAircraftKinds(applicant.aircraftKinds || applicant.aircraftKind).join("、"))}</p><small>经验 ${applicant.experienceHours.toFixed(1)} 小时 · 月薪 ${formatMoney(applicant.salary)}</small></div><div class="company-inline-actions"><span class="tag warn">雇佣 ${formatMoney(applicant.hirePrice)}</span><button class="primary-btn" data-action="hire-company-pilot" data-id="${applicant.id}" type="button" ${state.company.funds < applicant.hirePrice ? "disabled" : ""}><i data-lucide="user-plus"></i><span>雇佣</span></button></div></article>`).join("") || companyEmpty("暂无候选人，请刷新招聘名单。");
}

function renderCompanyHangar() {
  if (!state.company.created) return;
  const fleet = companyManagedFleet();
  const families = [...new Set(fleet.map(aircraftManufacturerFamily))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const currentFilter = families.includes(state.companyHangarFilter) ? state.companyHangarFilter : "all";
  const query = String(state.companyHangarSearch || "").trim().toUpperCase();
  state.companyHangarFilter = currentFilter;
  if (els.companyHangarFilter) {
    els.companyHangarFilter.innerHTML = `<option value="all">全部制造商</option>${families.map((family) => `<option value="${escapeHtml(family)}">${escapeHtml(family)}</option>`).join("")}`;
    els.companyHangarFilter.value = currentFilter;
  }
  if (els.companyHangarSearch) els.companyHangarSearch.value = state.companyHangarSearch || "";
  const visibleFleet = fleet.filter((aircraft) => {
    const matchesFamily = currentFilter === "all" || aircraftManufacturerFamily(aircraft) === currentFilter;
    const searchable = `${aircraft.name} ${aircraftManufacturerFamily(aircraft)} ${aircraft.kind} ${aircraftFleetNumber(aircraft)} ${aircraft.catalogId || ""}`.toUpperCase();
    return matchesFamily && (!query || searchable.includes(query));
  });
  els.companyHangarSummary.innerHTML = `<div><span>机队规模</span><strong>${fleet.length} 架</strong><small>含公司初始飞机</small></div><div><span>当前筛选</span><strong>${visibleFleet.length} 架</strong><small>按机型或编号查看</small></div><div><span>公司配备</span><strong>${fleet.filter((aircraft) => isCompanyAircraft(aircraft)).length}</strong><small>公司专属飞机</small></div><div><span>维修状态</span><strong>${fleet.filter((aircraft) => aircraftCondition(aircraft) < 95).length}</strong><small>需要关注</small></div>`;
  els.companyHangarGrid.innerHTML = visibleFleet.map((aircraft) => renderManagedAircraftCard(aircraft, "company")).join("") || companyEmpty("没有符合条件的公司飞机。");
}

function renderCompanyFinance() {
  if (!state.company.created) return;
  const transactions = Array.isArray(state.company.transactions) ? state.company.transactions : [];
  const income = transactions.reduce((sum, transaction) => sum + Math.max(0, Number(transaction.amount) || 0), 0);
  const expense = transactions.reduce((sum, transaction) => sum + Math.max(0, -(Number(transaction.amount) || 0)), 0);
  els.companyFinanceSummary.innerHTML = `<div><span>公司余额</span><strong>${formatMoney(state.company.funds)}</strong><small>当前可用</small></div><div><span>累计收入</span><strong class="is-income">+${formatMoney(income)}</strong><small>注资和经营收入</small></div><div><span>累计支出</span><strong class="is-expense">-${formatMoney(expense)}</strong><small>招聘与培训</small></div><div><span>净变动</span><strong>${formatMoney(income - expense)}</strong><small>公司账户累计</small></div>`;
  els.companyTransactionList.innerHTML = transactions.map((transaction) => {
    const amount = Number(transaction.amount) || 0;
    const positive = amount >= 0;
    return `<article class="fund-transaction"><span class="fund-transaction-icon ${positive ? "is-income" : "is-expense"}" aria-hidden="true"><i data-lucide="${positive ? "arrow-down-left" : "arrow-up-right"}"></i></span><div class="fund-transaction-detail"><strong>${escapeHtml(transaction.title)}</strong><span>${escapeHtml(transaction.detail || "公司资金记录")} · ${new Date(transaction.date).toLocaleString("zh-CN")}</span></div><div class="fund-transaction-amount"><strong class="${positive ? "is-income" : "is-expense"}">${positive ? "+" : "-"}${formatMoney(Math.abs(amount))}</strong><span>余额 ${formatMoney(transaction.balance)}</span></div></article>`;
  }).join("") || `<p class="fund-empty">暂无公司资金记录。</p>`;
}

function companyFlightStatusLabel(status) {
  return ({ assigned: "已派遣", completed: "已完成", crashed: "坠机", "airport-mismatch": "机场不符" })[status] || "待校验";
}

function companyAirportCheckLabel(log) {
  if (log?.airportCheck === "passed") return "起降机场已通过";
  if (log?.airportCheck === "failed") return "起降机场不符";
  return "等待实际起降数据";
}

function renderCompanyFlightLogs() {
  if (!els.companyFlightLogList) return;
  if (!state.company?.created) {
    els.companyFlightLogList.innerHTML = companyEmpty("创建公司后显示公司航班日志。");
    return;
  }
  const logs = Array.isArray(state.company.flightLogs) ? state.company.flightLogs : [];
  els.companyFlightLogList.innerHTML = logs.map((log) => {
    const status = companyFlightStatusLabel(log.status);
    const statusClass = log.status === "crashed" || log.status === "airport-mismatch" ? "bad" : log.status === "completed" ? "good" : "info";
    const planned = `${escapeHtml(log.origin || "未知")} → ${escapeHtml(log.destination || "未知")}`;
    const actual = log.departureAirport || log.arrivalAirport
      ? `${escapeHtml(log.departureAirport || "未知")} → ${escapeHtml(log.arrivalAirport || "未知")}`
      : "实际机场：尚未记录";
    const safety = Number.isFinite(Number(log.landingPeakG)) ? `接地峰值 ${Number(log.landingPeakG).toFixed(2)}G` : "接地峰值：尚未记录";
    return `<article class="company-row company-flight-log-row"><div class="company-row-main"><strong>${escapeHtml(log.title || "公司航班任务")}</strong><p>${planned} · ${escapeHtml(log.pilotName || "未分配飞行员")} · ${escapeHtml(log.aircraftName || "未分配飞机")}</p><small>${actual} · ${escapeHtml(companyAirportCheckLabel(log))} · ${safety}</small></div><div class="company-row-meta"><span class="tag ${statusClass}">${status}</span><small>${log.createdAt ? new Date(log.createdAt).toLocaleString("zh-CN") : ""}</small></div></article>`;
  }).join("") || `<p class="company-muted">暂无公司航班任务记录。</p>`;
}

function renderAchievements() {
  const rows = achievementDefs.map((def) => {
    const unlocked = state.achievements.find((item) => item.id === def.id)?.unlocked;
    return `
      <article class="achievement-card">
        <div class="mission-head">
          <div>
            <h3>${def.title}</h3>
            <p>${def.desc}</p>
          </div>
          <span class="tag ${unlocked ? "good" : "warn"}">${unlocked ? "已达成" : "未完成"}</span>
        </div>
      </article>`;
  }).join("");
  els.achievementList.innerHTML = rows;
}

function renderRankTimeline() {
  const currentHours = state.stats.totalHours;
  els.profileRankTimeline.innerHTML = rankRules.map((rank, index) => {
    const reached = currentHours >= rank.minHours;
    return `
      <article class="rank-card">
        <div class="mission-head">
          <div>
            <h3>${rank.rank}</h3>
            <p>${rank.minHours}${rank.nextHours ? ` - ${rank.nextHours} 小时` : "以上"}</p>
          </div>
          <span class="tag ${reached ? "good" : "warn"}">${reached ? "已到达" : "未到达"}</span>
        </div>
      </article>`;
  }).join("");
}

function renderAircraftLicenses() {
  if (!els.aircraftLicenseList) return;
  const records = normalizeAircraftLicenses(state.licenses);
  state.licenses = records;
  const licensedCount = records.filter((record) => record.purchased && record.assessmentCompleted).length;
  els.licenseProgress.textContent = `${licensedCount} / ${records.length}`;
  els.aircraftLicenseList.innerHTML = records.map((record) => {
    const license = aircraftLicense(record.id);
    if (!license) return "";
    const purchased = record.purchased;
    const licensed = purchased && record.assessmentCompleted;
    const pendingAssessment = purchased && !licensed;
    const affordable = state.cash >= license.cost;
    return `<article class="aircraft-license-row ${licensed ? "is-licensed" : pendingAssessment ? "is-pending" : ""}">
      <div class="aircraft-license-icon"><i data-lucide="${licensed ? "badge-check" : pendingAssessment ? "clipboard-check" : "plane"}"></i></div>
      <div class="aircraft-license-main"><strong>${escapeHtml(license.name)}</strong><span>${escapeHtml(license.kind)} · ${licensed ? "已取得执照" : pendingAssessment ? "待完成机型考核" : "需要购买考核资格"}</span></div>
      <div class="aircraft-license-action">${licensed
        ? `<span class="tag good">已拥有</span>`
        : pendingAssessment
          ? `<span class="tag warn">考核任务进行中</span>`
        : `<button class="ghost-btn license-buy-btn" data-action="buy-aircraft-license" data-id="${escapeHtml(license.id)}" type="button" ${affordable ? "" : "disabled"}><i data-lucide="credit-card"></i><span>${formatMoney(license.cost)}</span></button>`}</div>
    </article>`;
  }).join("");
}

function renderProfileOverview() {
  const rank = getRankInfo(state.stats.totalHours);
  const base = airportByIcao(state.pilot.base);
  els.profileOverview.innerHTML = `
    <div class="mission-head">
      <div>
        <h3>${escapeHtml(state.pilot.name)}</h3>
        <p>${escapeHtml(state.pilot.base)}${base ? ` · ${escapeHtml(base.name)}` : ""}</p>
      </div>
      <span class="tag info">${rank.rank}</span>
    </div>
    <div class="tag-row">
      <span class="tag">飞行 ${state.stats.totalHours.toFixed(1)} 小时</span>
      <span class="tag">声望 ${state.reputation}</span>
      <span class="tag">完成 ${state.stats.completedMissions} 次任务</span>
      <span class="tag">资产 ${formatMoney(state.cash)}</span>
    </div>`;
}

function renderFundTransactions() {
  const transactions = normalizeFundTransactions(state.fundTransactions, state.cash);
  const operatingTransactions = transactions.filter((transaction) => transaction.type !== "opening");
  const totalIncome = operatingTransactions.reduce((sum, transaction) => sum + Math.max(0, Number(transaction.amount) || 0), 0);
  const totalExpense = operatingTransactions.reduce((sum, transaction) => sum + Math.max(0, -(Number(transaction.amount) || 0)), 0);
  els.fundSummary.innerHTML = `
    <div><span>当前余额</span><strong>${formatMoney(state.cash)}</strong><small>所有收支后的可用资金</small></div>
    <div><span>累计收入</span><strong class="is-income">+${formatMoney(totalIncome)}</strong><small>任务、航段与出售收入</small></div>
    <div><span>累计支出</span><strong class="is-expense">-${formatMoney(totalExpense)}</strong><small>燃油、飞机与维修支出</small></div>`;
  els.fundTransactionList.innerHTML = transactions.map((transaction) => {
    const amount = Number(transaction.amount) || 0;
    const isOpening = transaction.type === "opening";
    const isIncome = amount > 0 && !isOpening;
    const amountClass = isOpening ? "is-opening" : isIncome ? "is-income" : "is-expense";
    const icon = isOpening ? "wallet-cards" : isIncome ? "arrow-down-left" : "arrow-up-right";
    const amountText = isOpening ? formatMoney(amount) : `${isIncome ? "+" : "-"}${formatMoney(Math.abs(amount))}`;
    return `
      <article class="fund-transaction">
        <span class="fund-transaction-icon ${amountClass}" aria-hidden="true"><i data-lucide="${icon}"></i></span>
        <div class="fund-transaction-detail">
          <strong>${escapeHtml(transaction.title)}</strong>
          <span>${escapeHtml(transaction.detail || "资金记录")} · ${new Date(transaction.date).toLocaleString("zh-CN")}</span>
        </div>
        <div class="fund-transaction-amount">
          <strong class="${amountClass}">${amountText}</strong>
          <span>余额 ${formatMoney(Number(transaction.balance) || 0)}</span>
        </div>
      </article>`;
  }).join("") || `<p class="fund-empty">暂无资金使用记录。</p>`;
}

function emptyCard(text) {
  return `<article class="mission-card"><p>${text}</p></article>`;
}

function renderAll() {
  updateRankAndAchievements();
  renderProfile();
  renderAirline();
  renderSopMonitor();
  renderMissions();
  renderSchedules();
  renderLogs();
  renderDashboardSettlement();
  renderHangar();
  renderAircraftManagement();
  renderCompanyManagement();
  renderAchievements();
  renderProfileOverview();
  renderFundTransactions();
  renderRankTimeline();
  renderAircraftLicenses();
  showView(state.activeView);
  saveState();
  wireIcons();
}

function wireIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { width: 16, height: 16 } });
  }
}

const SOP_STAGE_POINTS = {
  lighting: 15,
  taxi: 10,
  takeoff: 15,
  cruise: 15,
  landing: 25,
  parking: 10,
  shutdown: 10
};

const SOP_MONITOR_RULES = [
  { id: "lighting", name: "灯光", flag: "lightingConfirmed", points: 15, objective: "启动后灯光配置", requirement: "发动机运行时开启防撞灯；夜间或低能见度运行时同时开启位置灯。", trigger: "发动机已运行且飞机位于地面时开始检查。", telemetry: "发动机、地面状态、防撞灯、位置灯、昼夜状态", deductions: ["防撞灯关闭：扣 5 分", "夜间位置灯关闭：扣 4 分"], penalty: "-5 / -4", codes: ["lighting-beacon", "lighting-nav"] },
  { id: "taxi", name: "滑行", flag: "taxiConfirmed", points: 10, objective: "安全地面移动", requirement: "发动机运行、飞机在地面移动，地速不得超过 35 kt，并保持滑行灯开启；起飞滑跑与降落滑跑不计入滑行速度。", trigger: "首次起飞前，地面速度超过 1 kt 后进入滑行检查。", telemetry: "地面状态、发动机、地速、滑行灯、起飞构型", deductions: ["滑行地速超过 35 kt：扣 6 分", "滑行灯关闭：扣 2 分"], penalty: "-6 / -2", codes: ["taxi-speed", "taxi-light"] },
  { id: "takeoff", name: "起飞", flag: "takeoffConfirmed", points: 15, objective: "跑道进入与离地", requirement: "起飞前完成有效滑行；进入跑道和离地阶段开启着陆灯及频闪灯。", trigger: "飞机离地且地速达到 35 kt 时判定起飞。", telemetry: "地面状态、地速、滑行阶段、着陆灯、频闪灯", deductions: ["未完成滑行即起飞：扣 8 分", "着陆灯关闭：扣 4 分", "频闪灯关闭：扣 3 分"], penalty: "-8 / -4 / -3", codes: ["takeoff-before-taxi", "takeoff-light", "takeoff-strobe"] },
  { id: "cruise", name: "巡航", flag: "cruiseConfirmed", points: 15, objective: "达到最低巡航剖面", requirement: "固定翼无线电高度达到 3000 ft，直升机或旋翼机达到 1000 ft，并连续保持至少 20 秒。", trigger: "离地后达到对应机型的最低无线电高度开始计时。", telemetry: "无线电高度、机型类别、离地状态、保持时间", deductions: ["未完成最低高度和保持时间即进近：扣 5 分"], penalty: "-5", codes: ["landing-before-cruise"] },
  { id: "landing", name: "着陆", flag: "landingConfirmed", points: 25, objective: "在任务目标有效接地", requirement: "在任务目的机场、任务区域或指定返回机场完成有效接地，并记录接地率、峰值载荷及跑道。", trigger: "任务到达条件成立并收到一次有效接地事件。", telemetry: "目标距离、地面状态、接地率、峰值 G、机场与跑道", deductions: ["此阶段不设置固定扣分；接地数据写入最终报告"], penalty: "-", codes: [] },
  { id: "parking", name: "停机", flag: "parkingConfirmed", points: 10, objective: "落地后安全停稳", requirement: "接地后将地速降低到 5 kt 以下，连续停稳 5 秒，并设置停留刹车。", trigger: "有效着陆后，飞机在地面且地速不高于 5 kt 时开始计时。", telemetry: "地面状态、地速、停稳时间、停留刹车", deductions: ["停稳后未设置停留刹车：扣 5 分"], penalty: "-5", codes: ["parking-brake"] },
  { id: "shutdown", name: "关车", flag: "shutdownConfirmed", points: 10, objective: "完成关车程序", requirement: "完成停机检查后关闭发动机；关车完成前任务不会进行最终结算。", trigger: "停机阶段通过后持续监测发动机运行状态。", telemetry: "停机阶段、发动机运行状态", deductions: ["此阶段不设置固定扣分；未关车时任务保持待完成"], penalty: "-", codes: [] }
];

function sopBooleanLabel(sample, names, onText = "开启", offText = "关闭") {
  const value = sopBoolean(sample, names);
  return value === null ? "无数据" : value ? onText : offText;
}

function sopLiveValues(rule, sample, sop, aircraft) {
  if (!sample && rule.id !== "landing") return ["等待 MSFS 遥测"];
  const speed = Number(sample?.groundSpeedKt);
  const radioAltitude = Number(sample?.radioAltitudeFt);
  const onGround = sample ? sopBooleanLabel(sample, ["onGround"], "在地面", "已离地") : "无数据";
  const elapsed = (startedAt, limit) => startedAt ? `${Math.min(limit, Math.max(0, Math.floor((Date.now() - Number(startedAt)) / 1000)))} / ${limit} 秒` : `0 / ${limit} 秒`;
  if (rule.id === "lighting") return [
    `发动机：${sopBooleanLabel(sample, ["engineRunning"], "运行", "关闭")}`,
    `防撞灯：${sopBooleanLabel(sample, ["antiCollisionLights", "beaconLights", "beaconLightOn", "lights.beacon"])}`,
    `位置灯：${sopBooleanLabel(sample, ["navigationLights", "navLights", "navLightOn", "lights.nav"])}`,
    `昼夜：${sopBooleanLabel(sample, ["isNight", "environment.isNight"], "夜间", "日间")}`
  ];
  if (rule.id === "taxi") {
    const taxiCompleted = sop?.taxiConfirmed === true && (sop?.takeoffRollStartedAt || sop?.takeoffConfirmed === true);
    const taxiSpeed = taxiCompleted ? Number(sop.taxiLastGroundSpeedKt) : speed;
    const taxiLight = taxiCompleted && sop.taxiLastLight !== null && sop.taxiLastLight !== undefined
      ? (sop.taxiLastLight ? "开启" : "关闭")
      : sopBooleanLabel(sample, ["taxiLights", "taxiLightOn", "lights.taxi"]);
    return [
      taxiCompleted ? (sop?.takeoffConfirmed ? "地面阶段已结束" : "起飞滑跑已开始") : onGround,
      `地面速度：${Number.isFinite(taxiSpeed) ? taxiSpeed.toFixed(1) : "--"} kt`,
      `滑行灯：${taxiLight}`
    ];
  }
  if (rule.id === "takeoff") return [onGround, `地速：${Number.isFinite(speed) ? speed.toFixed(1) : "--"} kt`, `着陆灯：${sopBooleanLabel(sample, ["landingLights", "landingLightOn", "lights.landing"])}`, `频闪灯：${sopBooleanLabel(sample, ["strobeLights", "strobeLightOn", "lights.strobe"])}`];
  if (rule.id === "cruise") {
    const minimum = sopAircraftIsRotorcraft(aircraft) ? 1000 : 3000;
    return [onGround, `无线电高度：${Number.isFinite(radioAltitude) ? radioAltitude.toFixed(0) : "--"} ft`, `最低要求：${minimum} ft`, `保持时间：${elapsed(sop.cruiseStartedAt, 20)}`];
  }
  if (rule.id === "landing") {
    const landing = sop.landingData || {};
    return [onGround, `接地率：${Number.isFinite(Number(landing.landingRateFpm)) ? `-${Math.abs(Number(landing.landingRateFpm)).toFixed(0)}` : "--"} fpm`, `峰值载荷：${Number.isFinite(Number(landing.peakG)) ? Number(landing.peakG).toFixed(2) : "--"} G`, `跑道：${landing.runway || "--"}`];
  }
  if (rule.id === "parking") return [onGround, `地速：${Number.isFinite(speed) ? speed.toFixed(1) : "--"} kt`, `停稳时间：${elapsed(sop.parkingStartedAt, 5)}`, `停留刹车：${sopBooleanLabel(sample, ["parkingBrake", "parkingBrakeSet", "brakes.parking"], "已设置", "未设置")}`];
  return [`停机阶段：${sop.parkingConfirmed ? "已完成" : "未完成"}`, `发动机：${sopBooleanLabel(sample, ["engineRunning"], "运行", "已关闭")}`];
}

function renderSopMonitor() {
  if (!els.sopMonitor || !els.sopMonitorScore || !els.sopMonitorSummary || !els.sopMonitorTable) return;
  const mission = activeVerifiedMission();
  const enabled = isSopMode();
  const sop = mission?.verification?.sop || defaultSopState();
  const deductions = Array.isArray(sop.deductions) ? sop.deductions : [];
  const score = Math.max(0, Math.min(100, Number(sop.score ?? 100) || 0));
  const currentRule = enabled && mission ? SOP_MONITOR_RULES.find((rule) => sop[rule.flag] !== true) : null;
  const completedRules = SOP_MONITOR_RULES.filter((rule) => sop[rule.flag] === true);
  const lostPointsTotal = deductions.reduce((total, item) => total + Math.max(0, Number(item.points) || 0), 0);
  const sample = lastTelemetryConnected ? (lastSimulatorPayload?.sample || lastTelemetry) : null;
  const aircraft = mission ? missionAircraft(mission) : currentAircraft();

  els.sopMonitor.classList.toggle("is-disabled", !enabled);
  els.sopMonitor.classList.toggle("is-live", enabled && Boolean(mission) && lastTelemetryConnected);
  els.sopMonitorScore.textContent = enabled ? `${Math.round(score)}/100` : "未开启";
  els.sopMonitorScore.className = deductions.length ? "is-penalty" : enabled && mission ? "is-good" : "";
  els.sopMonitorSummary.textContent = isFreeMode()
    ? "自由模式下 SOP 检测暂停。"
    : !enabled
      ? "在设置中开启 SOP 模式后开始监测。"
      : !mission
        ? "接受任务后按 100 分制实时监测。"
        : !lastTelemetryConnected
          ? "任务已接受，正在等待 MSFS 遥测。"
          : `${mission.origin || "任务起点"} → ${mission.destination || "任务现场"} · ${completedRules.length}/7 项完成`;

  if (els.sopModeStatus) {
    els.sopModeStatus.textContent = isFreeMode() ? "自由模式暂停" : enabled ? mission ? "考核进行中" : "已开启" : "未开启";
    els.sopModeStatus.className = `sop-page-mode ${enabled && !isFreeMode() ? "is-enabled" : ""}`;
  }
  if (els.sopMissionName) els.sopMissionName.textContent = mission ? `${mission.title || mission.category || "飞行任务"} · ${mission.origin || "起点"} → ${mission.destination || "任务现场"}` : "尚未接受任务";
  if (els.sopCurrentStage) els.sopCurrentStage.textContent = currentRule?.name || (mission && completedRules.length === SOP_MONITOR_RULES.length ? "全部完成" : "等待开始");
  if (els.sopCompletedCount) els.sopCompletedCount.textContent = `${completedRules.length} / ${SOP_MONITOR_RULES.length}`;
  if (els.sopDeductionTotal) els.sopDeductionTotal.textContent = `${lostPointsTotal} 分`;
  if (els.sopTelemetryStatus) els.sopTelemetryStatus.textContent = lastTelemetryConnected ? "MSFS 已连接" : "等待 MSFS";

  if (els.sopStageTrack) {
    els.sopStageTrack.innerHTML = SOP_MONITOR_RULES.map((rule, index) => {
      const stageDeductions = deductions.filter((item) => rule.codes.includes(String(item.code || "")));
      const className = stageDeductions.length ? "is-penalty" : sop[rule.flag] === true ? "is-pass" : currentRule?.id === rule.id ? "is-current" : "is-waiting";
      return `<div class="sop-stage-step ${className}"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(rule.name)}</strong><small>${stageDeductions.length ? `已扣 ${stageDeductions.reduce((sum, item) => sum + Number(item.points || 0), 0)} 分` : sop[rule.flag] === true ? "已通过" : currentRule?.id === rule.id ? lastTelemetryConnected ? "监测中" : "等待遥测" : "待检查"}</small></div><b>${rule.points}</b></div>`;
    }).join("");
  }

  const rows = SOP_MONITOR_RULES.map((rule, index) => {
    const stageDeductions = deductions.filter((item) => rule.codes.includes(String(item.code || "")));
    const lostPoints = stageDeductions.reduce((total, item) => total + Math.max(0, Number(item.points) || 0), 0);
    const confirmed = sop[rule.flag] === true;
    const status = !enabled || !mission
      ? "待检查"
      : lostPoints > 0
        ? `已扣 ${lostPoints} 分`
        : confirmed
          ? "通过"
          : currentRule?.id === rule.id
            ? lastTelemetryConnected ? "监测中" : "等待遥测"
            : "待检查";
    const statusClass = lostPoints > 0 ? "is-penalty" : confirmed ? "is-pass" : currentRule?.id === rule.id && enabled && mission ? "is-current" : "is-waiting";
    const liveValues = sopLiveValues(rule, sample, sop, aircraft);
    return `<tr class="${statusClass}">
      <th scope="row"><span class="sop-stage-number">${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(rule.name)}</strong><small>阶段权重 ${rule.points} 分</small></th>
      <td data-label="状态"><span class="sop-status-label">${escapeHtml(status)}</span></td>
      <td data-label="操作要求"><strong>${escapeHtml(rule.objective)}</strong><p>${escapeHtml(rule.requirement)}</p><small><b>触发：</b>${escapeHtml(rule.trigger)}</small></td>
      <td data-label="实时监测"><p class="sop-telemetry-source">监测：${escapeHtml(rule.telemetry)}</p><div class="sop-live-values">${liveValues.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div></td>
      <td data-label="扣分规则"><ul>${rule.deductions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></td>
    </tr>`;
  }).join("");
  els.sopMonitorTable.innerHTML = `<table class="sop-detail-table">
    <thead><tr><th>阶段</th><th>状态</th><th>操作要求与触发条件</th><th>实时监测数据</th><th>扣分规则</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  if (els.sopDeductionList) {
    const unavailable = Array.isArray(sop.dataUnavailable) ? sop.dataUnavailable : [];
    const warning = unavailable.length ? `<div class="sop-data-warning"><span class="sop-list-indicator" aria-hidden="true"></span><div><strong>部分遥测不可用</strong><span>${escapeHtml(unavailable.join("、"))}暂时无法读取，相关检查将按可用数据继续。</span></div></div>` : "";
    els.sopDeductionList.innerHTML = warning + (deductions.length ? deductions.map((item) => `<article class="sop-deduction-item"><time>${new Date(Number(item.at) || Date.now()).toLocaleTimeString("zh-CN")}</time><div><strong>${escapeHtml(item.title || "SOP 操作扣分")}</strong><p>${escapeHtml(item.detail || "未提供详细说明")}</p></div><b>-${Math.max(0, Number(item.points) || 0)}</b></article>`).join("") : `<div class="sop-deduction-empty"><span class="sop-list-indicator" aria-hidden="true"></span><div><strong>暂无扣分记录</strong><span>${mission ? "保持规范操作，违规记录会实时出现在这里。" : "接受任务并开启 SOP 模式后开始记录。"}</span></div></div>`);
  }
}

function defaultSopState() {
  return {
    enabled: false,
    score: 100,
    deductions: [],
    phase: "lighting",
    lightingConfirmed: false,
    taxiConfirmed: false,
    takeoffConfirmed: false,
    cruiseConfirmed: false,
    landingConfirmed: false,
    parkingConfirmed: false,
    shutdownConfirmed: false,
    taxiStartedAt: null,
    taxiLastGroundSpeedKt: null,
    taxiLastLight: null,
    takeoffRollStartedAt: null,
    cruiseStartedAt: null,
    parkingStartedAt: null,
    parkingBrakeSeenSet: false,
    lastEngineRunning: null,
    lastOnGround: null,
    lastSampleAt: null,
    dataUnavailable: []
  };
}

function ensureSopState(verification) {
  verification.sop = { ...defaultSopState(), ...(verification.sop || {}) };
  verification.sop.score = Math.max(0, Math.min(100, Number(verification.sop.score ?? 100) || 0));
  verification.sop.deductions = Array.isArray(verification.sop.deductions) ? verification.sop.deductions : [];
  verification.sop.dataUnavailable = Array.isArray(verification.sop.dataUnavailable) ? verification.sop.dataUnavailable : [];
  return verification.sop;
}

function sopSampleValue(sample, names) {
  for (const name of names) {
    const value = name.split(".").reduce((current, key) => current?.[key], sample);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function sopBoolean(sample, names) {
  const value = sopSampleValue(sample, names);
  if (value === undefined) return null;
  if (typeof value === "boolean") return value;
  return Number(value) > 0.5 || ["true", "on", "yes"].includes(String(value).trim().toLowerCase());
}

function recordSopDataUnavailable(sop, key) {
  if (!sop.dataUnavailable.includes(key)) sop.dataUnavailable.push(key);
}

function updateSopDataAvailability(sop, key, unavailable) {
  if (unavailable) {
    recordSopDataUnavailable(sop, key);
    return;
  }
  sop.dataUnavailable = sop.dataUnavailable.filter((item) => item !== key);
}

function applySopDeduction(mission, code, title, points, detail) {
  if (!isSopMode() || !mission?.verification) return false;
  const sop = ensureSopState(mission.verification);
  if (sop.deductions.some((item) => item.code === code)) return false;
  const deduction = Math.max(0, Number(points) || 0);
  sop.score = Math.max(0, Math.round((Number(sop.score || 100) - deduction) * 10) / 10);
  sop.deductions.push({ code, title, points: deduction, detail, at: Date.now() });
  recordTaskEvent(mission, {
    key: "sop-violation",
    title: "SOP 操作扣分",
    detail: `${title}，扣 ${deduction} 分：${detail}。当前 SOP 得分 ${sop.score}/100。`,
    phase: mission.verification.phase
  });
  return true;
}

function sopAircraftIsRotorcraft(aircraft) {
  return /直升机|旋翼机/.test(String(aircraft?.kind || ""));
}

function sopTakeoffRollActive(onGround, speed, taxiConfirmed, landingLight, strobe) {
  return onGround === true
    && taxiConfirmed === true
    && Number(speed) >= 35
    && (landingLight === true || strobe === true);
}

function sopParkingDecision(startedAt, parkingBrake, brakeSeenSet, now = Date.now()) {
  const parkedLongEnough = Number.isFinite(Number(startedAt)) && now - Number(startedAt) >= 5_000;
  const brakeConfirmed = parkingBrake === null || parkingBrake === true || brakeSeenSet === true;
  return {
    parkedLongEnough,
    shouldDeduct: parkedLongEnough && parkingBrake === false && brakeSeenSet !== true,
    canConfirm: parkedLongEnough && brakeConfirmed
  };
}

function evaluateSopTelemetry(mission, sample, aircraft, { landing = null, arrived = false } = {}) {
  if (!isSopMode() || !mission?.verification || !sample) return null;
  const verification = mission.verification;
  const sop = ensureSopState(verification);
  sop.enabled = true;
  const onGround = telemetryBoolean(sample.onGround);
  const engineRunning = sample.engineRunning === undefined || sample.engineRunning === null ? null : telemetryBoolean(sample.engineRunning);
  const speed = Math.max(0, Number(sample.groundSpeedKt) || 0);
  const radioAltitude = Math.max(0, Number(sample.radioAltitudeFt) || 0);
  const landingLight = sopBoolean(sample, ["landingLights", "landingLightOn", "lights.landing"]);
  const antiCollision = sopBoolean(sample, ["antiCollisionLights", "beaconLights", "beaconLightOn", "lights.beacon"]);
  const nav = sopBoolean(sample, ["navigationLights", "navLights", "navLightOn", "lights.nav"]);
  const strobe = sopBoolean(sample, ["strobeLights", "strobeLightOn", "lights.strobe"]);
  const taxiLight = sopBoolean(sample, ["taxiLights", "taxiLightOn", "lights.taxi"]);
  const parkingBrake = sopBoolean(sample, ["parkingBrake", "parkingBrakeSet", "brakes.parking"]);
  const night = (() => {
    const explicit = sopBoolean(sample, ["isNight", "environment.isNight"]);
    return explicit === null ? null : explicit;
  })();
  updateSopDataAvailability(sop, "灯光", [landingLight, antiCollision, nav, strobe, taxiLight].every((value) => value === null));
  updateSopDataAvailability(sop, "停留刹车", parkingBrake === null);
  if (engineRunning !== null) updateSopDataAvailability(sop, "发动机状态", false);

  if (engineRunning === true && onGround && !sop.lightingConfirmed) {
    if (antiCollision === false) applySopDeduction(mission, "lighting-beacon", "防撞灯未开启", 5, "发动机运行时应开启防撞灯");
    if (nav === false && night !== false) applySopDeduction(mission, "lighting-nav", "位置灯未开启", 4, "夜间或低能见度运行应开启位置灯");
    if (antiCollision !== false && nav !== false) {
      sop.lightingConfirmed = antiCollision !== null || nav !== null ? true : sop.lightingConfirmed;
      if (sop.lightingConfirmed) recordTaskEvent(mission, { key: "sop-stage", title: "SOP 灯光检查完成", detail: "已完成发动机启动后的灯光检查。", phase: "lighting" });
    }
  }

  const takeoffRoll = sopTakeoffRollActive(onGround, speed, sop.taxiConfirmed, landingLight, strobe);
  if (takeoffRoll) {
    sop.takeoffRollStartedAt ||= Date.now();
    sop.phase = "takeoff";
  }

  if (engineRunning === true && onGround && speed > 0.5 && !sop.takeoffConfirmed && !takeoffRoll) {
    sop.taxiStartedAt ||= Date.now();
    sop.taxiLastGroundSpeedKt = speed;
    if (taxiLight !== null) sop.taxiLastLight = taxiLight;
    if (speed > 35) applySopDeduction(mission, "taxi-speed", "滑行速度过高", 6, `地面速度 ${speed.toFixed(0)} kt，超过 35 kt 的通用滑行上限`);
    if (taxiLight === false) applySopDeduction(mission, "taxi-light", "滑行灯未开启", 2, "滑行阶段应开启滑行灯");
    if (!sop.taxiConfirmed && speed <= 35) {
      sop.taxiConfirmed = true;
      recordTaskEvent(mission, { key: "sop-stage", title: "SOP 滑行检查完成", detail: "已检测到发动机运行、地面移动和合理滑行速度。", phase: "taxi" });
    }
  }

  const airborne = !onGround && speed >= 35;
  if (airborne && !sop.takeoffConfirmed) {
    if (!sop.taxiConfirmed) applySopDeduction(mission, "takeoff-before-taxi", "未完成滑行程序即起飞", 8, "起飞前未检测到有效滑行阶段");
    if (landingLight === false) applySopDeduction(mission, "takeoff-light", "起飞灯光配置错误", 4, "起飞阶段应开启着陆灯或等效起飞灯光");
    if (strobe === false) applySopDeduction(mission, "takeoff-strobe", "频闪灯未开启", 3, "进入跑道和起飞阶段应开启防撞频闪灯");
    sop.takeoffConfirmed = true;
    sop.takeoffRollStartedAt ||= Date.now();
    sop.phase = "cruise";
    recordTaskEvent(mission, { key: "sop-stage", title: "SOP 起飞检查完成", detail: "已检测到离地并开始爬升。", phase: "takeoff" });
  }

  const cruiseAltitude = sopAircraftIsRotorcraft(aircraft) ? 1000 : 3000;
  if (!onGround && radioAltitude >= cruiseAltitude) {
    sop.cruiseStartedAt ||= Date.now();
    if (!sop.cruiseConfirmed && Date.now() - sop.cruiseStartedAt >= 20_000) {
      sop.cruiseConfirmed = true;
      sop.phase = "cruise";
      recordTaskEvent(mission, { key: "sop-stage", title: "SOP 巡航检查完成", detail: `已达到 ${cruiseAltitude} ft 以上并保持巡航。`, phase: "cruise" });
    }
  }

  if (landing || arrived) {
    if (!sop.cruiseConfirmed && sop.takeoffConfirmed) applySopDeduction(mission, "landing-before-cruise", "未完成巡航阶段即进近", 5, "未达到最低巡航高度或保持时间");
    if (landing) {
      sop.landingData = {
        landingRateFpm: Number.isFinite(Number(landing.landingRateFpm)) ? Math.abs(Number(landing.landingRateFpm)) : null,
        peakG: Number.isFinite(Number(landing.peakG)) ? Number(landing.peakG) : null,
        airport: String(landing.airport || ""),
        runway: String(landing.runway || ""),
        touchdownSpeedKt: Number.isFinite(Number(landing.touchdownSpeedKt)) ? Number(landing.touchdownSpeedKt) : null,
        touchdownPitchDeg: Number.isFinite(Number(landing.touchdownPitchDeg)) ? Number(landing.touchdownPitchDeg) : null,
        touchdownBankDeg: Number.isFinite(Number(landing.touchdownBankDeg)) ? Number(landing.touchdownBankDeg) : null,
        bounceCount: Number.isFinite(Number(landing.bounceCount)) ? Number(landing.bounceCount) : null,
        rateSource: String(landing.rateSource || ""),
        rateConfidence: String(landing.rateConfidence || ""),
        reportAt: Date.parse(landing.timestamp || "") || null
      };
      sop.landingConfirmed = true;
      sop.phase = "parking";
      recordTaskEvent(mission, { key: "sop-stage", title: "SOP 着陆检查完成", detail: "已检测到任务机场或任务点的有效接地数据。", phase: "landing" });
    }
  }

  if (onGround && speed <= 5 && (landing || arrived || sop.landingConfirmed)) {
    sop.parkingStartedAt ||= Date.now();
    if (parkingBrake === true) sop.parkingBrakeSeenSet = true;
    const parkingDecision = sopParkingDecision(sop.parkingStartedAt, parkingBrake, sop.parkingBrakeSeenSet);
    if (parkingDecision.shouldDeduct) applySopDeduction(mission, "parking-brake", "停机未设置停留刹车", 5, "飞机连续停稳 5 秒后仍未设置停留刹车");
    if (parkingDecision.canConfirm) {
      if (!sop.parkingConfirmed) recordTaskEvent(mission, { key: "sop-stage", title: "SOP 停机检查完成", detail: "飞机已在地面停稳并完成停机检查。", phase: "parking" });
      sop.parkingConfirmed = true;
      sop.phase = "shutdown";
    }
  } else if (sop.landingConfirmed && !sop.parkingConfirmed) {
    sop.parkingStartedAt = null;
    sop.parkingBrakeSeenSet = false;
  }

  if (sop.parkingConfirmed && engineRunning === false) {
    if (!sop.shutdownConfirmed) recordTaskEvent(mission, { key: "sop-stage", title: "SOP 关车检查完成", detail: "已停稳、设置停留刹车并关闭发动机。", phase: "shutdown" });
    sop.shutdownConfirmed = true;
    sop.phase = "complete";
  } else if (sop.parkingConfirmed && engineRunning === null) {
    updateSopDataAvailability(sop, "发动机状态", true);
    sop.shutdownConfirmed = true;
    sop.phase = "complete";
  }
  sop.lastEngineRunning = engineRunning;
  sop.lastOnGround = onGround;
  sop.lastSampleAt = Date.now();
  return sop;
}

function sopCompletionPrompt(sop, sample) {
  const score = Math.round(Number(sop?.score ?? 100));
  if (!sop?.parkingConfirmed) {
    const elapsed = sop?.parkingStartedAt ? Math.floor((Date.now() - Number(sop.parkingStartedAt)) / 1000) : 0;
    const remaining = Math.max(0, 5 - elapsed);
    const parkingBrake = sopBoolean(sample, ["parkingBrake", "parkingBrakeSet", "brakes.parking"]);
    const brakeInstruction = parkingBrake === false ? "，并设置停留刹车" : "";
    return `已检测到有效着陆，请保持地面速度不超过 5 kt 并停稳 ${remaining} 秒${brakeInstruction}。当前得分 ${score}/100。`;
  }
  const engineRunning = sample?.engineRunning == null ? null : telemetryBoolean(sample.engineRunning);
  if (engineRunning === true) return `停机检查已完成，请关闭发动机完成关车。当前得分 ${score}/100。`;
  return `停机和关车检查即将完成。当前得分 ${score}/100。`;
}

function buildSopReport(sop = {}, landing = {}) {
  const deductions = Array.isArray(sop.deductions) ? sop.deductions : [];
  const stageDefinitions = [
    ["lighting", "灯光", "lightingConfirmed", 15],
    ["taxi", "滑行", "taxiConfirmed", 10],
    ["takeoff", "起飞", "takeoffConfirmed", 15],
    ["cruise", "巡航", "cruiseConfirmed", 15],
    ["landing", "着陆", "landingConfirmed", 25],
    ["parking", "停机", "parkingConfirmed", 10],
    ["shutdown", "关车", "shutdownConfirmed", 10]
  ];
  const stages = stageDefinitions.map(([id, name, flag, points]) => {
    const stageDeductions = deductions.filter((item) => String(item.code || "").startsWith(`${id}-`)
      || (id === "lighting" && String(item.code || "").includes("light"))
      || (id === "takeoff" && String(item.code || "").includes("takeoff"))
      || (id === "landing" && String(item.code || "").includes("landing"))
      || (id === "parking" && String(item.code || "").includes("parking")));
    const confirmed = sop[flag] === true;
    return {
      id,
      name,
      points,
      confirmed,
      status: stageDeductions.length ? "有扣分" : confirmed ? "通过" : "未完成",
      deductions: stageDeductions
    };
  });
  const landingData = {
    landingRateFpm: Number.isFinite(Number(landing.landingRateFpm ?? sop.landingData?.landingRateFpm)) ? Math.abs(Number(landing.landingRateFpm ?? sop.landingData.landingRateFpm)) : null,
    peakG: Number.isFinite(Number(landing.landingPeakG ?? landing.peakG ?? sop.landingData?.peakG)) ? Number(landing.landingPeakG ?? landing.peakG ?? sop.landingData.peakG) : null,
    wearPercent: Number.isFinite(Number(landing.landingWearPercent)) ? Number(landing.landingWearPercent) : null,
    airport: String(landing.landingAirport ?? landing.airport ?? sop.landingData?.airport ?? ""),
    runway: String(landing.landingRunway ?? landing.runway ?? sop.landingData?.runway ?? ""),
    touchdownSpeedKt: Number.isFinite(Number(landing.touchdownSpeedKt ?? sop.landingData?.touchdownSpeedKt)) ? Number(landing.touchdownSpeedKt ?? sop.landingData.touchdownSpeedKt) : null,
    touchdownPitchDeg: Number.isFinite(Number(landing.touchdownPitchDeg ?? sop.landingData?.touchdownPitchDeg)) ? Number(landing.touchdownPitchDeg ?? sop.landingData.touchdownPitchDeg) : null,
    touchdownBankDeg: Number.isFinite(Number(landing.touchdownBankDeg ?? sop.landingData?.touchdownBankDeg)) ? Number(landing.touchdownBankDeg ?? sop.landingData.touchdownBankDeg) : null,
    bounceCount: Number.isFinite(Number(landing.bounceCount ?? sop.landingData?.bounceCount)) ? Number(landing.bounceCount ?? sop.landingData.bounceCount) : null,
    rateSource: String(landing.rateSource ?? sop.landingData?.rateSource ?? ""),
    rateConfidence: String(landing.rateConfidence ?? sop.landingData?.rateConfidence ?? ""),
    reportAt: Number.isFinite(Number(landing.landingReportAt ?? sop.landingData?.reportAt)) ? Number(landing.landingReportAt ?? sop.landingData.reportAt) : null
  };
  const score = Math.max(0, Math.min(100, Number(sop.score ?? 100) || 0));
  return {
    score,
    multiplier: sopRewardMultiplier(true, score),
    stages,
    deductions,
    dataUnavailable: Array.isArray(sop.dataUnavailable) ? sop.dataUnavailable : [],
    landing: landingData
  };
}

function sopRewardMultiplier(enabled, score) {
  if (!enabled) return 1;
  const normalizedScore = Math.max(0, Math.min(100, Number(score) || 0));
  return normalizedScore >= 100 ? 1.3 : normalizedScore / 100;
}

function buildLandingSopSnapshot(mission, landingWear, landing, aircraft, reportAt, arrival = "") {
  const missionSop = mission?.verification?.sop || {};
  const sopEnabled = (typeof isSopMode === "function" && isSopMode()) || missionSop.enabled === true;
  const sopScore = sopEnabled ? Math.max(0, Math.min(100, Number(missionSop.score ?? 100) || 0)) : 100;
  const sopMultiplier = sopRewardMultiplier(sopEnabled, sopScore);
  if (!sopEnabled) return { sopEnabled: false, sopScore: 100, sopMultiplier: 1, sopDeductions: [], sopReport: null };
  const landingActual = typeof landingReportActual === "function"
    ? landingReportActual(landing, aircraft)
    : {};
  const sopReport = typeof buildSopReport === "function"
    ? buildSopReport(missionSop, {
      ...landingActual,
      landingRateFpm: landingWear?.landingRateFpm,
      landingPeakG: landingWear?.peakG,
      landingWearPercent: landingWear?.wearPercent,
      landingAirport: arrival || landingActual.landingAirport,
      landingRunway: String(landing?.runway || landingActual.landingRunway || ""),
      landingReportAt: reportAt,
      landingReport: landing
    })
    : null;
  return {
    sopEnabled: true,
    sopScore,
    sopMultiplier,
    sopDeductions: missionSop.deductions || [],
    sopReport
  };
}

function acceptMission(id) {
  const mission = state.missions.find((item) => item.id === id);
  if (!mission || mission.status !== "open") return;
  const activeMission = state.missions.find((item) => item.status === "accepted");
  if (activeMission && activeMission.id !== mission.id) {
    toast(`当前已有执行中任务：${activeMission.title}，完成或结束后再接受新任务`);
    return;
  }
  const aircraft = currentAircraft();
  if (!isFreeMode() && !mission.permittedAircraftIds?.includes(aircraft.id)) {
    toast(`请先在机库选择适配机型：${mission.aircraftHint}`);
    return;
  }
  mission.scene = { ...missionScene(mission), phase: "active", activatedAt: Date.now() };
  mission.status = "accepted";
  mission.acceptedAt = Date.now();
  mission.verification = {
    phase: "briefed",
    phaseLabel: "等待正确机场起飞",
    detail: isFreeMode() ? `自由模式：使用 ${aircraft.name} 执行任务，不限制机型和接地` : `请在 ${mission.origin} 地面使用 ${aircraft.name} 起飞`,
    flightDistanceNm: 0,
    lastPoint: null,
    actualAircraft: "",
    aircraftId: aircraft.id,
    aircraftName: aircraft.name,
    sceneState: mission.site ? "waiting" : null,
    sceneDetail: mission.site ? "接近任务现场 12 nm 后自动生成场景对象" : "",
    sceneRetryAt: 0,
    flightPlanState: "waiting",
    flightPlanDetail: "等待 MSFS 遥测连接后发送任务航路",
    flightPlanFormatVersion: 2,
    lastTelemetryTimestamp: "",
    teleportLocked: false,
    teleportReason: "",
    teleportDistanceNm: 0,
    teleportElapsedSec: 0,
    ignoredTelemetryJumps: 0,
    lastVoiceKey: "briefing",
    engineRunning: null,
    engineStartAnnounced: false,
    outboundStartPoint: null,
    departureAirport: null,
    arrivalAirport: null,
    landingDwellStartedAt: null,
    landingDwellSeconds: 0,
    targetLandingConfirmed: false,
    arrivalNoticeAnnounced: false,
    rewardEligible: null,
    fuelStartKg: null,
    fuelCurrentKg: null,
    fuelLastKg: null,
    fuelUsedKg: 0,
    fuelAddedKg: 0,
    fuelUpdatedAt: null,
    sop: { ...defaultSopState(), enabled: isSopMode() }
  };
  recordTaskEvent(mission, {
    key: "accepted",
    title: "任务已接受",
    detail: `使用 ${aircraft.name} 从 ${mission.origin} 出发，等待 MSFS 实时遥测。`,
    phase: "briefed"
  });
  queueVoice(`任务已接受。请使用${aircraft.name}前往${mission.origin}，确认停在地面后起飞。`);
  toast(`${isFreeMode() ? "自由模式：" : ""}已接受任务：${mission.title}`);
  renderAll();
  if (lastTelemetryConnected) void syncMissionFlightPlan(mission);
  showView("map");
}

let flightPlanSyncPromise = null;

async function syncMissionFlightPlan(mission) {
  if (!mission?.verification) return;
  const origin = airportByIcao(mission.origin);
  const targetAirport = airportByIcao(mission.destination);
  const target = mission.site?.lat != null
    ? {
        icao: "TASK",
        name: "任务现场",
        lat: mission.site.lat,
        lon: mission.site.lon,
        type: "UserWaypoint"
      }
    : targetAirport && {
        icao: targetAirport.icao,
        name: targetAirport.name,
        lat: targetAirport.lat,
        lon: targetAirport.lon,
        type: "Airport"
      };
  if (!origin || !target) {
    mission.verification.flightPlanState = "error";
    mission.verification.flightPlanDetail = "无法生成航路：任务机场坐标缺失";
    saveState();
    renderAll();
    return;
  }
  if (flightPlanSyncPromise) return;
  flightPlanSyncPromise = (async () => {
    mission.verification.flightPlanState = "connecting";
    mission.verification.flightPlanDetail = "正在连接 MSFS 导航系统";
    saveState();
    renderAll();
    try {
      const response = await fetch("/api/simulator/flight-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          missionId: mission.id,
          origin: { icao: origin.icao, name: origin.name, lat: origin.lat, lon: origin.lon, type: "Airport" },
          target,
          returnPoint: { icao: origin.icao, name: origin.name, lat: origin.lat, lon: origin.lon, type: "Airport" }
        })
      });
      const payload = await response.json();
      const waitingForSimulator = response.status === 409 && payload.reason === "simulator-not-connected";
      mission.verification.flightPlanState = response.ok ? payload.state || "connecting" : waitingForSimulator ? "waiting" : "error";
      mission.verification.flightPlanDetail = response.ok
        ? payload.state === "prepared"
          ? payload.message || "任务航路文件已安全生成"
          : "任务航路已发送，等待 MSFS 确认"
        : waitingForSimulator ? "等待 MSFS 遥测连接后自动发送任务航路" : payload.message || "MSFS 航路加载失败";
      await saveState();
      renderAll();
    } catch {
      mission.verification.flightPlanState = "error";
      mission.verification.flightPlanDetail = "无法连接 MSFS 航路服务";
      saveState();
      renderAll();
    }
  })().finally(() => { flightPlanSyncPromise = null; });
  await flightPlanSyncPromise;
}

function completeMission(id, actual = {}) {
  const mission = state.missions.find((item) => item.id === id);
  if (!mission || mission.status !== "accepted") return;
  const aircraft = missionAircraft(mission);
  const hours = Number.isFinite(actual.hours) ? actual.hours : +(mission.duration * rand(0.95, 1.08)).toFixed(1);
  const miles = Number.isFinite(actual.miles) ? Math.round(actual.miles) : Math.round(mission.distance * rand(0.95, 1.05));
  const rewardEligible = actual.rewardEligible !== false;
  const missionSop = mission.verification?.sop || {};
  const sopEnabled = (state.settings?.sopMode === true && state.settings?.freeMode !== true) || missionSop.enabled === true;
  const sopScore = sopEnabled ? Math.max(0, Math.min(100, Number(actual.sopScore ?? missionSop.score ?? 100) || 0)) : 100;
  const sopMultiplier = sopRewardMultiplier(sopEnabled, sopScore);
  const baseGrossIncome = rewardEligible ? Math.round(mission.payout * (aircraft.rented ? 0.8 : 1)) : 0;
  const grossIncome = Math.round(baseGrossIncome * sopMultiplier);
  const fuelStartCandidate = actual.fuelStartKg ?? mission.verification?.fuelStartKg;
  const fuelEndCandidate = actual.fuelEndKg ?? mission.verification?.fuelCurrentKg;
  const fuelStartKg = fuelStartCandidate !== null && fuelStartCandidate !== "" && Number.isFinite(Number(fuelStartCandidate))
    ? Math.max(0, Number(fuelStartCandidate))
    : null;
  const fuelEndKg = fuelEndCandidate !== null && fuelEndCandidate !== "" && Number.isFinite(Number(fuelEndCandidate))
    ? Math.max(0, Number(fuelEndCandidate))
    : null;
  const fuelUsedKg = Math.max(0, Number(actual.fuelUsedKg ?? mission.verification?.fuelUsedKg) || 0);
  const fuelCost = Math.round(fuelUsedKg * FUEL_PRICE_PER_KG);
  const landingRateFpm = Number.isFinite(Number(actual.landingRateFpm)) ? Math.abs(Number(actual.landingRateFpm)) : null;
  const landingPeakG = Number.isFinite(Number(actual.landingPeakG)) ? Number(actual.landingPeakG) : null;
  const landingWear = Number.isFinite(Number(actual.landingWearPercent)) ? Math.max(0, Number(actual.landingWearPercent)) : null;
  const landingReportAt = Number.isFinite(Number(actual.landingReportAt)) ? Number(actual.landingReportAt) : null;
  const sopReport = typeof buildSopReport === "function"
    ? buildSopReport(missionSop, { ...actual, ...(typeof landingReportActual === "function" ? landingReportActual(actual.landingReport || null, aircraft) : {}), landingWearPercent: landingWear, landingReportAt })
    : { score: sopScore, multiplier: sopMultiplier, stages: [], deductions: missionSop.deductions || [], dataUnavailable: [], landing: { landingRateFpm, peakG: landingPeakG, wearPercent: landingWear, airport: String(actual.landingAirport || actual.arrivalAirport || ""), runway: String(actual.landingRunway || ""), reportAt: landingReportAt } };
  const income = grossIncome - fuelCost;
  const baseRepGain = rewardEligible ? mission.repGain + (mission.category === "医疗" ? 4 : 0) : 0;
  const repMultiplier = sopEnabled ? sopScore / 100 : 1;
  const repGain = Math.round(baseRepGain * repMultiplier);
  const assessmentPassed = mission.kind === "license-assessment" && rewardEligible;
  const scene = missionScene(mission);
  const manualCompletion = actual.manualCompletion === true;
  const actualLog = state.logs.find((log) => log.source === "msfs"
    && log.missionId === mission.id
    && log.aircraftId === aircraft.id);
  mission.status = "completed";
  mission.completedAt = Date.now();
  mission.manualCompleted = manualCompletion;
  mission.scene = { ...scene, phase: "completed", completedAt: mission.completedAt };
  if (mission.verification) {
    mission.verification.phase = "completed";
    mission.verification.phaseLabel = "已落地，任务完成";
    mission.verification.rewardEligible = rewardEligible;
    mission.verification.sop = {
      ...missionSop,
      enabled: sopEnabled,
      score: sopScore,
      multiplier: sopMultiplier,
      report: sopReport,
      settledAt: Date.now()
    };
    mission.verification.detail = rewardEligible
      ? `已在 ${actual.arrivalAirport || mission.origin} 关车，机场检查通过。`
      : `已在 ${actual.arrivalAirport || "未知机场"} 结束任务，但出发或到达机场不符合要求，本次无奖励。`;
  }
  if (mission.kind === "license-assessment" && mission.licenseAssessmentId) {
    const record = state.licenses.find((item) => item.id === mission.licenseAssessmentId);
    if (record?.purchased && assessmentPassed) {
      record.assessmentCompleted = true;
      record.assessmentCompletedAt = Date.now();
      record.assessmentMissionId = mission.id;
    }
    mission.assessmentResult = assessmentPassed ? "passed" : "failed";
  }
  recordTaskEvent(mission, {
    key: "completed",
    title: "任务完成，结算信息",
    detail: rewardEligible
      ? `已从 ${actual.departureAirport || mission.origin} 起飞并在 ${actual.arrivalAirport || mission.destination || mission.origin} 关车。${sopEnabled ? `SOP 得分 ${Math.round(sopScore)}/100，奖励折算 ${Math.round(sopMultiplier * 100)}%，声望按 ${Math.round(repMultiplier * 100)}% 结算。` : ""}任务收入 ${formatMoney(grossIncome)}，实际燃油 ${formatFuel(fuelUsedKg)}，燃油成本 ${formatMoney(fuelCost)}，净收入 ${formatMoney(income)}，声望 +${repGain}。`
      : `出发机场 ${actual.departureAirport || "未知"} 或到达机场 ${actual.arrivalAirport || "未知"} 与任务不一致，本次无奖励。实际燃油 ${formatFuel(fuelUsedKg)}，成本 ${formatMoney(fuelCost)}。`,
    voiceText: rewardEligible ? "任务完成，已安全到达目的机场。" : "任务已结束，但机场校验未通过，本次没有奖励。",
    phase: "completed"
  });
  if (grossIncome > 0) {
    recordFundTransaction({
      amount: grossIncome,
      type: "mission-income",
      title: "任务收入",
      detail: mission.title,
      referenceId: mission.id
    });
  }
  if (fuelCost > 0) {
    recordFundTransaction({
      amount: -fuelCost,
      type: "fuel-expense",
      title: "任务燃油支出",
      detail: `${mission.title} · ${formatFuel(fuelUsedKg)}`,
      referenceId: mission.id
    });
  }
  state.reputation += repGain;
  state.stats.completedMissions += 1;
  if (!actualLog) {
    state.stats.totalHours = +(Number(state.stats.totalHours || 0) + hours).toFixed(2);
    state.stats.totalMiles = +(Number(state.stats.totalMiles || 0) + miles).toFixed(1);
    state.stats.totalLandings = Number(state.stats.totalLandings || 0) + 2;
    state.stats.totalFuelKg = +(Number(state.stats.totalFuelKg || 0) + fuelUsedKg).toFixed(2);
    state.stats.totalFuelCost = +(Number(state.stats.totalFuelCost || 0) + fuelCost).toFixed(2);
  }
  if (fuelEndKg !== null) {
    aircraft.lastFuelKg = +fuelEndKg.toFixed(2);
    aircraft.lastFuelAt = Date.now();
  }
  const completedArrivalAirport = normalizeBaseCode(actual.arrivalAirport || actual.landingAirport || mission.destination || mission.origin);
  if (completedArrivalAirport) {
    aircraft.lastLandingAirport = completedArrivalAirport;
  }
  const sopNotes = sopEnabled
    ? `SOP 得分 ${Math.round(sopScore)}/100，奖励按 ${Math.round(sopMultiplier * 100)}% 结算，声望按 ${Math.round(repMultiplier * 100)}% 结算。${missionSop.deductions?.length ? `扣分原因：${missionSop.deductions.map((item) => `${item.title}(-${item.points})`).join("、")}。` : ""}`
    : "";
  const settlementNotes = `${actual.notes || "已通过 MSFS 实际飞行校验。"} ${sopNotes} ${fuelUsedKg > 0 ? `任务累计燃油消耗 ${formatFuel(fuelUsedKg)}，成本 ${formatMoney(fuelCost)}。` : ""}${isPackagedScene(scene) ? `现场对象：${scene.objectTitle}。` : ""}${rewardEligible ? "" : " 机场不一致，无奖励。"}`;
  if (actualLog) {
    actualLog.taskTitle = mission.title;
    actualLog.departureAirport = normalizeBaseCode(actual.departureAirport || actualLog.departureAirport || mission.origin);
    actualLog.arrivalAirport = normalizeBaseCode(actual.arrivalAirport || actualLog.arrivalAirport || mission.destination || mission.origin);
    actualLog.from = actualLog.departureAirport || actualLog.from;
    actualLog.to = actualLog.arrivalAirport || actualLog.to;
    actualLog.airportCheck = rewardEligible ? "passed" : "failed";
    actualLog.income = income;
    actualLog.grossIncome = grossIncome;
    actualLog.taskFuelUsedKg = +fuelUsedKg.toFixed(2);
    actualLog.taskFuelCost = fuelCost;
    actualLog.rewardEligible = rewardEligible;
    actualLog.manualCompletion = manualCompletion;
    actualLog.sopEnabled = sopEnabled;
    actualLog.sopScore = sopScore;
    actualLog.sopMultiplier = sopMultiplier;
    actualLog.sopDeductions = missionSop.deductions || [];
    actualLog.sopReport = sopReport;
    actualLog.settledAt = Date.now();
    if (landingRateFpm !== null) actualLog.landingRateFpm = landingRateFpm;
    if (landingPeakG !== null) actualLog.landingPeakG = landingPeakG;
    if (landingWear !== null) actualLog.landingWearPercent = landingWear;
    if (actual.landingAirport) actualLog.landingAirport = actual.landingAirport;
    if (actual.landingRunway) actualLog.landingRunway = actual.landingRunway;
    if (landingReportAt !== null) actualLog.landingReportAt = landingReportAt;
    actualLog.notes = `${actualLog.notes || ""} ${settlementNotes}`.trim();
  } else {
    state.logs.unshift({
      id: cryptoId("log"),
      source: "mission",
      missionId: mission.id,
      taskTitle: mission.title,
      date: Date.now(),
      from: mission.origin || mission.title.split(" → ")[0],
      to: mission.destination || mission.site?.base || mission.title.split(" → ")[1],
      aircraftId: aircraft.id,
      aircraftName: aircraft.name,
      hours,
      miles,
      income,
      grossIncome,
      fuelStartKg,
      fuelEndKg,
      fuelUsedKg: +fuelUsedKg.toFixed(2),
      fuelCost,
      landingRateFpm,
      landingPeakG,
      landingWearPercent: landingWear,
      landingAirport: String(actual.landingAirport || actual.arrivalAirport || ""),
      landingRunway: String(actual.landingRunway || ""),
      landingReportAt,
      rewardEligible,
      manualCompletion,
      sopEnabled,
      sopScore,
      sopMultiplier,
      sopDeductions: missionSop.deductions || [],
      sopReport,
      notes: settlementNotes
    });
  }
  if (typeof refreshMissionFromAircraft === "function") refreshMissionFromAircraft(aircraft);
  if (assessmentPassed) {
    toast(`考核通过：已取得 ${mission.aircraftHint} 机型执照`);
  } else if (mission.kind === "license-assessment") {
    const license = aircraftLicense(mission.licenseAssessmentId);
    const retry = license && !hasAircraftLicense(license.id) && !activeLicenseAssessment(license.id)
      ? createLicenseAssessmentMission(license)
      : null;
    if (retry) state.missions.unshift(retry);
    toast("考核未通过，请按指定机场重新完成考核");
  } else {
    toast(rewardEligible
      ? `结算完成：净收入 ${formatMoney(income)}，实际燃油 ${formatFuel(fuelUsedKg)}`
      : `任务无奖励，实际燃油成本 ${formatMoney(fuelCost)}`);
  }
  maybeAutoUnlockAircraft();
  maybeAutoCreateMission();
  renderAll();
}

async function manualCompleteMission(id) {
  const mission = state.missions.find((item) => item.id === id);
  if (!mission || mission.status !== "accepted" || endingMissionIds.has(id)) return;
  const aircraft = missionAircraft(mission);
  const verification = mission.verification || {};
  const sample = lastTelemetryConnected ? lastTelemetry : null;
  if (sample && sample.onGround !== undefined && sample.onGround !== null && !telemetryBoolean(sample.onGround)) {
    toast("检测到飞机仍在空中，落地后才能手动完成任务");
    return;
  }

  const expectedArrival = normalizeBaseCode(mission.destination || mission.origin);
  const observedAirport = normalizeBaseCode(sample ? telemetryAirport(sample)?.airport?.icao : "");
  const arrivalAirport = observedAirport
    || normalizeBaseCode(verification.arrivalAirport)
    || normalizeBaseCode(aircraft?.lastLandingAirport)
    || expectedArrival;
  const departureAirport = normalizeBaseCode(verification.departureAirport || mission.origin);
  const departureMatches = departureAirport === normalizeBaseCode(mission.origin);
  const arrivalMatches = arrivalAirport === expectedArrival;
  const rewardEligible = departureMatches && arrivalMatches;
  const confirmation = rewardEligible
    ? `确定手动完成“${mission.title}”吗？系统将使用当前航迹、燃油和接地数据进行结算。`
    : `当前识别到出发 ${departureAirport || "未知"}、到达 ${arrivalAirport || "未知"}，与任务要求不一致。仍要手动结束任务吗？本次不会获得奖励。`;
  if (!await showConfirmDialog(confirmation)) return;

  const departedAt = Number(verification.departedAt) || 0;
  const hours = departedAt > 0
    ? Math.max(0.1, +((Date.now() - departedAt) / 3600000).toFixed(2))
    : Math.max(0.1, Number(mission.duration) || 0.1);
  const landingReportAt = Number(aircraft?.lastLandingReportAt) || null;
  endingMissionIds.add(id);
  try {
    writeBackup(`手动完成任务前：${mission.title}`);
    await fetch("/api/simulator/scene", { method: "DELETE" }).catch(() => {});
    await fetch("/api/simulator/flight-plan", { method: "DELETE" }).catch(() => {});
    completeMission(id, {
      hours,
      miles: Math.max(0, Number(verification.flightDistanceNm) || 0),
      departureAirport,
      arrivalAirport,
      rewardEligible,
      fuelStartKg: verification.fuelStartKg,
      fuelEndKg: sample ? telemetryFuelKg(sample) : verification.fuelCurrentKg,
      fuelUsedKg: verification.fuelUsedKg,
      landingRateFpm: Number.isFinite(Number(aircraft?.lastLandingRateFpm)) ? Number(aircraft.lastLandingRateFpm) : null,
      landingPeakG: Number.isFinite(Number(aircraft?.lastLandingPeakG)) ? Number(aircraft.lastLandingPeakG) : null,
      landingWearPercent: Number.isFinite(Number(aircraft?.lastLandingWearPercent)) ? Number(aircraft.lastLandingWearPercent) : null,
      landingAirport: arrivalAirport,
      landingRunway: String(aircraft?.lastLandingRunway || ""),
      landingReportAt,
      manualCompletion: true,
      notes: `用户在落地后手动完成任务：出发 ${departureAirport || "未知"}，到达 ${arrivalAirport || "未知"}。`
    });
  } finally {
    endingMissionIds.delete(id);
  }
}

function activeVerifiedMission() {
  return state.missions.find((mission) => mission.status === "accepted" && mission.verification);
}

function telemetryAirport(sample) {
  const mission = activeVerifiedMission();
  const missionAirports = [airportByIcao(mission?.origin), airportByIcao(mission?.destination)].filter(Boolean);
  if (missionAirports.length && Number.isFinite(Number(sample?.latitude)) && Number.isFinite(Number(sample?.longitude))) {
    const point = { lat: Number(sample.latitude), lon: Number(sample.longitude) };
    const nearbyMissionAirport = missionAirports
      .map((airport) => ({ airport, distance: distanceNm(point, airport) }))
      .filter((item) => item.distance <= 4)
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearbyMissionAirport) return nearbyMissionAirport;
  }
  const nearby = nearestKnownAirport(Number(sample?.latitude), Number(sample?.longitude));
  if (nearby) return nearby;
  const reported = String(sample?.runwayAirport || "").toUpperCase();
  return airportByIcao(reported) ? { airport: airportByIcao(reported), distance: Number.POSITIVE_INFINITY } : null;
}

function applySceneBridgeStatus(mission, status) {
  if (!mission?.verification || (status.missionId && status.missionId !== mission.id)) return;
  const verification = mission.verification;
  if (status.state === "created") {
    verification.sceneState = "created";
    verification.sceneDetail = status.smokeCreated
      ? `${missionScene(mission).objectTitle} 与任务烟雾已生成，对象编号 ${status.objectId} / ${status.smokeObjectId}`
      : `${missionScene(mission).objectTitle} 已生成，MSFS 对象编号 ${status.objectId}`;
    verification.sceneObjectId = status.objectId;
    verification.sceneSmokeObjectId = status.smokeObjectId || null;
  } else if (status.state === "error") {
    verification.sceneState = "error";
    verification.sceneRetryAt = Date.now() + 30_000;
    verification.sceneDetail = Number(status.exception) === 22
      ? "MSFS 未加载任务对象或烟雾包，请重启 MSFS 后软件会自动重试"
      : `对象生成失败：${status.message || "SimConnect 未确认对象"}`;
  } else if (status.state === "connecting") {
    verification.sceneState = "connecting";
    verification.sceneDetail = "正在连接 MSFS 场景桥";
  } else if (status.state === "waiting") {
    verification.sceneState = "waiting";
    verification.sceneRetryAt = Date.now() + Math.max(500, Number(status.retryAfterMs) || 2000);
    verification.sceneDetail = status.message || "正在等待 MSFS 连接稳定";
  } else {
    verification.sceneState = "creating";
    verification.sceneDetail = "正在任务坐标生成场景对象";
  }
  saveState();
}

async function syncMissionScene(mission, sample) {
  const scene = missionScene(mission);
  if (!mission.site || !isPackagedScene(scene) || !mission.verification) return;
  const currentPoint = { lat: Number(sample?.latitude), lon: Number(sample?.longitude) };
  if (!Number.isFinite(currentPoint.lat) || !Number.isFinite(currentPoint.lon)) return;
  const proximityNm = distanceNm(currentPoint, mission.site);
  mission.verification.sceneDistanceNm = proximityNm;
  if (proximityNm > Math.max(12, Number(scene.radiusNm || 0) * 2)) {
    if (mission.verification.sceneState !== "created") {
      mission.verification.sceneState = "waiting";
      mission.verification.sceneDetail = `距离任务现场 ${proximityNm.toFixed(1)} nm，进入 12 nm 范围后自动生成`;
    }
    return;
  }
  if (sceneSyncPromise) return;
  sceneSyncPromise = (async () => {
    const verification = mission.verification;
    if (["connecting", "creating", "created"].includes(verification.sceneState)) {
      const response = await fetch("/api/simulator/scene", { cache: "no-store" });
      if (!response.ok) throw new Error("Scene bridge status unavailable");
      const status = await response.json();
      if (status.state !== "idle") {
        applySceneBridgeStatus(mission, status);
        return;
      }
      verification.sceneState = "waiting";
      verification.sceneDetail = "场景桥已重启，正在恢复任务现场与烟雾";
    }
    if (["error", "waiting"].includes(verification.sceneState)
        && Date.now() < Number(verification.sceneRetryAt || 0)) return;
    verification.sceneState = "connecting";
    verification.sceneDetail = "正在连接 MSFS 场景桥";
    const response = await fetch("/api/simulator/scene", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        missionId: mission.id,
        objectTitle: scene.objectTitle,
        smokeTitle: missionSmokeTitle(scene),
        latitude: mission.site.lat,
        longitude: mission.site.lon,
        altitudeFt: 0,
        headingDeg: mission.site.bearing || 0
      })
    });
    applySceneBridgeStatus(mission, await response.json());
  })().catch(() => {
    mission.verification.sceneState = "error";
    mission.verification.sceneRetryAt = Date.now() + 30_000;
    mission.verification.sceneDetail = "场景桥暂时不可用，软件将在 30 秒后重试";
  }).finally(() => { sceneSyncPromise = null; });
  await sceneSyncPromise;
}

function processTelemetry(sample, landing, simulatorFlightAtLanding = state.simulatorFlight) {
  const mission = activeVerifiedMission();
  if (!mission || !sample) return;
  const verification = mission.verification;
  let aircraft = missionAircraft(mission);
  const airport = telemetryAirport(sample);
  const currentPoint = { lat: Number(sample.latitude), lon: Number(sample.longitude) };
  const sampleTimestamp = Date.parse(sample.timestamp || "");
  const onGround = telemetryBoolean(sample.onGround);
  void syncMissionScene(mission, sample);

  if (verification.teleportLocked && verification.teleportReason !== "slew") {
    verification.teleportLocked = false;
    verification.teleportReason = "";
    verification.teleportDistanceNm = 0;
    verification.teleportElapsedSec = 0;
  }

  if (verification.teleportLocked) {
    const resetAtBase = onGround
      && airport?.airport.icao === mission.origin
      && Number(sample.groundSpeedKt || 0) <= 30;
    if (resetAtBase) {
      verification.teleportLocked = false;
      verification.teleportReason = "";
      verification.teleportDistanceNm = 0;
      verification.teleportElapsedSec = 0;
      verification.flightDistanceNm = 0;
      verification.departedAt = null;
      verification.lastPoint = currentPoint;
      verification.lastTelemetryTimestamp = Number.isFinite(sampleTimestamp) ? sampleTimestamp : "";
      setMissionStatus(mission, {
        phase: "briefed",
        label: "快速位移锁定已清除",
        detail: `已回到 ${mission.origin}，请从基地重新起飞。`,
        voiceKey: "teleport-reset",
        voiceText: "快速位移锁定已清除，请从基地重新起飞。"
      });
    } else {
      setMissionStatus(mission, {
        phase: verification.phase,
        label: "检测到快速位移模式",
        detail: `MSFS 报告 SLEW/快速位移模式，任务已暂停。请回到 ${mission.origin} 地面并重新起飞。`,
        voiceKey: "teleport-locked",
        voiceText: `检测到快速位移模式，任务已暂停。请回到${mission.origin}地面并重新起飞。`
      });
      saveState();
      renderMissions();
      renderLogs();
      wireIcons();
      return;
    }
  }

  const movement = assessTelemetryMovement(
    verification.lastPoint,
    currentPoint,
    verification.lastTelemetryTimestamp,
    sampleTimestamp,
    sample
  );
  const activeSlew = movement.kind === "slew" && verification.phase !== "briefed";
  if (activeSlew) {
      verification.teleportLocked = true;
      verification.teleportReason = "slew";
      verification.teleportDistanceNm = movement.stepNm;
      verification.teleportElapsedSec = movement.elapsedSec;
      setMissionStatus(mission, {
        phase: verification.phase,
        label: "检测到快速位移模式",
        detail: "检测到模拟器 SLEW/快速位移模式，任务已暂停。",
        voiceKey: "teleport-locked",
        voiceText: "检测到模拟器快速位移模式，任务已暂停。请关闭该模式并回到基地重新起飞。"
      });
      verification.lastPoint = currentPoint;
      verification.lastTelemetryTimestamp = Number.isFinite(sampleTimestamp) ? sampleTimestamp : "";
      saveState();
      renderMissions();
      renderLogs();
      wireIcons();
      return;
  }
  if (movement.kind === "jump") {
    verification.ignoredTelemetryJumps = Number(verification.ignoredTelemetryJumps || 0) + 1;
  } else if (movement.kind === "normal") {
    verification.flightDistanceNm = accumulateFlightDistance(verification.flightDistanceNm, movement.stepNm);
  }
  verification.lastPoint = currentPoint;
  verification.lastTelemetryTimestamp = Number.isFinite(sampleTimestamp) ? sampleTimestamp : verification.lastTelemetryTimestamp || "";
  verification.actualAircraft = telemetryAircraftLabel(sample) || "";
  if (!verification.actualAircraft && !isFreeMode()) {
    setMissionStatus(mission, {
      phase: verification.phase,
      label: "正在识别机型",
      detail: `SimConnect 已连接，正在读取任务机型 ${aircraft.name} 的 TITLE / ATC MODEL。`
    });
    saveState();
    renderLogs();
    return;
  }
  const detectedMissionAircraft = isFreeMode()
    ? (state.fleet.find((item) => !isCompanyAircraft(item) && telemetryMatchesAircraft(sample, item)) || aircraft)
    : telemetryMissionAircraft(sample, mission);
  if (!detectedMissionAircraft) {
    const permittedNames = missionPermittedAircraft(mission).map((item) => item.name).join(" / ") || aircraft.name;
    setMissionStatus(mission, {
      phase: verification.phase,
      label: "机型不匹配",
      detail: `检测到 ${verification.actualAircraft}，任务支持 ${permittedNames}`,
      voiceKey: "aircraft-mismatch",
      voiceText: `任务机型不匹配。当前检测到${verification.actualAircraft}，请切换到任务支持的机型。`
    });
    saveState();
    renderLogs();
    return;
  }
  if (verification.aircraftId !== detectedMissionAircraft.id) {
    verification.aircraftId = detectedMissionAircraft.id;
    verification.aircraftName = detectedMissionAircraft.name;
  }
  aircraft = detectedMissionAircraft;
  updateMissionFuel(verification, sample);
  const landingFlight = normalizeSimulatorFlight(simulatorFlightAtLanding);
  // The mission departure is the authoritative lower bound for its landing
  // report. The generic simulator flight can be restarted after touchdown
  // (or restored without a mission id), which must not invalidate this task's
  // already-recorded landing.
  const missionDepartedAt = Number(verification.departedAt);
  const activeFlightDepartedAt = landingFlight.active && landingFlight.aircraftId === aircraft.id
    ? Number(landingFlight.departedAt)
    : 0;
  const landingDepartedAt = Number.isFinite(missionDepartedAt) && missionDepartedAt > 0
    ? missionDepartedAt
    : activeFlightDepartedAt;
  const expectedLandingAirport = verification.phase === "returning"
    ? mission.origin
    : mission.destination || "";
  const careerLanding = !isFreeMode()
    && landingReportMatchesTouchdown(
      landing,
      sample,
      aircraft,
      landingDepartedAt,
      12 * 60 * 60_000,
      expectedLandingAirport
    )
    ? landing
    : null;
  const careerLandingActual = landingReportActual(careerLanding, aircraft);
  const sop = evaluateSopTelemetry(mission, sample, aircraft, { landing: careerLanding });
  const sopCanComplete = !isSopMode() || sop?.shutdownConfirmed === true;
  if (sample.engineRunning !== undefined && sample.engineRunning !== null) {
    const engineRunning = telemetryBoolean(sample.engineRunning);
    const phaseAllowsEngineNotice = !["target-confirmed", "returning", "completed"].includes(verification.phase);
    const shouldAnnounceEngineStart = engineRunning
      && !verification.engineStartAnnounced
      && phaseAllowsEngineNotice;
    if (shouldAnnounceEngineStart) {
      recordTaskEvent(mission, {
        key: "engine-started",
        title: "发动机启动",
        detail: `已检测到 ${aircraft.name} 发动机运行，等待确认起飞机场。`,
        voiceText: "发动机已启动，请确认起飞机场。",
        phase: verification.phase
      });
      verification.engineStartAnnounced = true;
    }
    verification.engineRunning = engineRunning;
  }
  const beginOutbound = (departureAirport) => {
    verification.departedAt = Date.now();
    verification.departureAirport = departureAirport || verification.departureAirport || null;
    // Start the outbound meter at the actual takeoff sample. Taxiing and parking
    // movement must not count toward reaching the mission site.
    verification.flightDistanceNm = 0;
    verification.outboundStartPoint = currentPoint;
    verification.lastPoint = currentPoint;
    setMissionStatus(mission, {
      phase: "outbound",
      label: "前往任务点",
      detail: `已从 ${verification.departureAirport || "未知机场"} 离地，飞往 ${mission.destination || "任务现场"}。`,
      voiceKey: "departed",
      voiceText: `已从${verification.departureAirport || "当前机场"}起飞，正在前往任务点。`,
      eventKey: "takeoff",
      eventTitle: "起飞"
    });
  };
  if (verification.phase === "briefed") {
    if (isFreeMode()) {
      const departed = !onGround && Number(sample.groundSpeedKt || 0) >= 20;
      if (departed) beginOutbound(airport?.airport?.icao || verification.departureAirport || mission.origin);
      else setMissionStatus(mission, {
        phase: "briefed",
        label: "自由模式待起飞",
        detail: `自由模式：不限机型和执照，使用 ${aircraft.name} 执行任务。`
      });
      if (!departed) {
        saveState();
        renderMissions();
        renderLogs();
        wireIcons();
        return;
      }
    }
    else if (onGround && airport?.airport.icao === mission.origin) {
      verification.departureAirport = airport.airport.icao;
      setMissionStatus(mission, {
        phase: "origin-confirmed",
        label: "出发机场已确认",
        detail: `已在 ${mission.origin} 地面确认，等待离地。`,
        voiceKey: "origin-confirmed",
        voiceText: `已确认${mission.origin}为起飞机场，可以起飞。`,
        eventKey: "origin-confirmed",
        eventTitle: "确认起飞机场"
      });
    } else if (onGround && airport?.airport.icao) {
      verification.departureAirport = airport.airport.icao;
      setMissionStatus(mission, {
        phase: "briefed",
        label: "起飞机场不一致",
        detail: `当前位于 ${airport.airport.icao}，任务要求 ${mission.origin}。允许继续飞行，但机场不一致将无法获得奖励。`,
        voiceKey: `wrong-origin-${airport.airport.icao}`,
        voiceText: `起飞机场不一致。当前是${airport.airport.icao}，任务要求${mission.origin}。继续飞行将没有奖励。`,
        eventKey: "departure-mismatch",
        eventTitle: "起飞机场不一致"
      });
    } else if (!onGround && Number(sample.groundSpeedKt) >= 35 && verification.departureAirport) {
      beginOutbound(verification.departureAirport);
    } else {
      setMissionStatus(mission, {
        phase: "briefed",
        label: "等待起飞",
        detail: `请将 ${aircraft.name} 停放在 ${mission.origin} 后起飞。`
      });
    }
  } else if (verification.phase === "origin-confirmed" && !onGround && Number(sample.groundSpeedKt) >= 35) {
    beginOutbound(verification.departureAirport || mission.origin);
  } else if (verification.phase === "outbound" || verification.phase === "airborne") {
    if (verification.phase === "airborne") verification.phase = "outbound";
    const target = mission.destination || "任务现场";
    const isSceneMission = Boolean(mission.site && !mission.destination);
    const arrivalRule = missionArrivalRule(mission);
    const targetRadius = arrivalRule.radiusNm;
    const targetDistance = isSceneMission ? distanceNm(currentPoint, mission.site) : null;

    if (mission.destination) {
      const arrivedAtAirport = isFreeMode()
        ? Boolean(airport?.airport?.icao === mission.destination)
        : onGround
        && Number(sample.groundSpeedKt || 0) <= 5
        && Boolean(airport?.airport?.icao)
        && Boolean(careerLanding)
        && sopCanComplete;
      if (arrivedAtAirport) {
        verification.arrivalAirport = airport.airport.icao;
        const departureMatches = normalizeBaseCode(verification.departureAirport) === normalizeBaseCode(mission.origin);
        const arrivalMatches = normalizeBaseCode(verification.arrivalAirport) === normalizeBaseCode(mission.destination);
        const rewardEligible = departureMatches && arrivalMatches;
        const flightHours = Math.max(0.1, +((Date.now() - verification.departedAt) / 3600000).toFixed(2));
        completeMission(mission.id, {
          hours: flightHours,
          miles: verification.flightDistanceNm,
          departureAirport: verification.departureAirport,
          arrivalAirport: verification.arrivalAirport,
          rewardEligible,
          ...careerLandingActual,
          notes: `MSFS 校验：出发 ${verification.departureAirport || "未知"}，已在 ${verification.arrivalAirport} 落地。`
        });
        return;
      } else {
        setMissionStatus(mission, {
          phase: "outbound",
          label: !isFreeMode() && onGround && Number(sample.groundSpeedKt || 0) <= 5 ? "正在确认着陆" : "前往目的机场",
          detail: !isFreeMode() && onGround && Number(sample.groundSpeedKt || 0) <= 5
            ? Boolean(careerLanding) && isSopMode() && !sopCanComplete
              ? sopCompletionPrompt(sop, sample)
              : "已检测到飞机接地，正在等待本次接地率和跑道数据。"
            : `实际航迹 ${Math.round(verification.flightDistanceNm || 0)} nm，目标 ${mission.destination}。到达后落地并关闭发动机。`
        });
      }
    } else {
      setMissionStatus(mission, {
        phase: "outbound",
        label: "前往任务点",
        detail: `实际航迹 ${Math.round(verification.flightDistanceNm || 0)} nm，距任务点 ${targetDistance.toFixed(1)} nm。`
      });
      const sceneArrivalMode = missionArrivalMode(mission);
      const minimumOutboundDistance = Math.max(5, Number(mission.distance || mission.site?.distanceNm || 0) - targetRadius);
      const enoughDistance = Number(verification.flightDistanceNm || 0) >= minimumOutboundDistance;
      const stationaryAtLandingSite = !isFreeMode() && sceneArrivalMode === "landing"
        && targetDistance <= targetRadius
        && onGround
        && Number(sample.groundSpeedKt || 0) <= arrivalRule.speedLimitKt
        && Boolean(careerLanding);
      let targetReached = false;
      if (sceneArrivalMode === "landing") {
        if (stationaryAtLandingSite) {
          verification.landingDwellStartedAt ||= Date.now();
          verification.landingDwellSeconds = Math.max(0, Math.floor((Date.now() - verification.landingDwellStartedAt) / 1000));
          if (verification.landingDwellSeconds < arrivalRule.dwellSeconds) {
            setMissionStatus(mission, {
              phase: "outbound",
              label: "任务点停留中",
              detail: `已在任务点 ${targetRadius} nm 内停稳，停留 ${verification.landingDwellSeconds} / ${arrivalRule.dwellSeconds} 秒。`
            });
          } else {
            targetReached = enoughDistance;
            if (!enoughDistance) {
              setMissionStatus(mission, {
                phase: "outbound",
                label: "等待有效航迹",
                detail: `已在任务点停稳，但有效航迹仅 ${Math.round(verification.flightDistanceNm || 0)} nm，还需达到 ${Math.round(minimumOutboundDistance)} nm。`
              });
            }
          }
        } else {
          verification.landingDwellStartedAt = null;
          verification.landingDwellSeconds = 0;
          if (!isFreeMode()
            && targetDistance <= targetRadius
            && onGround
            && Number(sample.groundSpeedKt || 0) <= arrivalRule.speedLimitKt) {
            setMissionStatus(mission, {
              phase: "outbound",
              label: "正在确认任务点着陆",
              detail: "已检测到飞机在任务点接地，正在等待本次接地数据。"
            });
          }
        }
      } else if (!isFreeMode()) {
        targetReached = targetDistance <= targetRadius
          && !onGround
          && Number(sample.groundSpeedKt || 0) <= arrivalRule.speedLimitKt
          && Number(sample.radioAltitudeFt || 0) <= 800;
      }

      // Scene tasks must cover nearly the full base-to-site distance before
      // the target radius can trigger. This blocks early confirmation from
      // stale coordinates or a short takeoff.
      if ((isFreeMode() && targetDistance <= targetRadius) || (targetReached && enoughDistance)) {
        const requiresLanding = !isFreeMode() && sceneArrivalMode === "landing";
        verification.targetLandingConfirmed = requiresLanding;
        setMissionStatus(mission, {
          phase: "target-confirmed",
          label: requiresLanding ? "任务点已落地确认" : "任务点已确认",
          detail: requiresLanding
            ? `已在 ${target} 安全落地并停稳，请完成现场作业后再次起飞返航。`
            : `已到达 ${target}，请完成目标后返回 ${mission.origin}。`,
          voiceKey: "target-confirmed",
          voiceText: requiresLanding
            ? "已在任务点安全落地，任务目标已确认。完成现场作业后，请再次起飞返航。"
            : `已到达任务点，任务目标已确认，请返回${mission.origin}。`,
          eventKey: "target-confirmed",
          eventTitle: requiresLanding ? "任务点落地确认" : "到达任务点，请返回机场"
        });
      }
    }
  } else if (verification.phase === "airport-arrived") {
    const arrivedAtAirport = isFreeMode()
      ? Boolean(airport?.airport?.icao === mission.destination)
      : onGround
      && Number(sample.groundSpeedKt || 0) <= 5
      && Boolean(airport?.airport?.icao)
      && Boolean(careerLanding)
      && sopCanComplete;
    if (arrivedAtAirport) {
      verification.arrivalAirport = airport.airport.icao;
      const rewardEligible = normalizeBaseCode(verification.departureAirport) === normalizeBaseCode(mission.origin)
        && normalizeBaseCode(verification.arrivalAirport) === normalizeBaseCode(mission.destination);
      const flightHours = Math.max(0.1, +((Date.now() - verification.departedAt) / 3600000).toFixed(2));
      completeMission(mission.id, {
        hours: flightHours,
        miles: verification.flightDistanceNm,
        departureAirport: verification.departureAirport,
        arrivalAirport: verification.arrivalAirport,
        rewardEligible,
        ...careerLandingActual,
        notes: `MSFS 校验：出发 ${verification.departureAirport || "未知"}，已在 ${verification.arrivalAirport} 落地。`
      });
      return;
    } else if (!onGround) {
      setMissionStatus(mission, {
        phase: "outbound",
        label: "前往目的机场",
        detail: `已离开 ${verification.arrivalAirport || "机场"}，请在 ${mission.destination} 落地。`
      });
    }
  } else if (verification.phase === "target-confirmed") {
    const readyToReturn = isFreeMode() || hasDepartedTaskSite(onGround, sample.groundSpeedKt);
    if (readyToReturn) {
      setMissionStatus(mission, {
        phase: "returning",
        label: "返航中",
        detail: `任务点已确认，请返回 ${mission.origin} 并落地。`,
        voiceKey: "returning",
        voiceText: `任务点已确认，请返航${mission.origin}。`,
        eventKey: "returning",
        eventTitle: "返航"
      });
    } else {
      setMissionStatus(mission, {
        phase: "target-confirmed",
        label: "现场作业中，等待返航起飞",
        detail: `任务点落地已确认。完成现场作业后再次起飞，系统才会发布返回 ${mission.origin} 的指令。`
      });
    }
  } else if (verification.phase === "returning") {
    const landedAtBase = isFreeMode()
      ? Boolean(airport?.airport?.icao === mission.origin)
      : onGround
      && airport?.airport.icao === mission.origin
      && Number(sample.groundSpeedKt || 0) <= 30
      && Boolean(careerLanding)
      && sopCanComplete;
    if (landedAtBase) {
      const flightHours = Math.max(0.1, +((Date.now() - verification.departedAt) / 3600000).toFixed(2));
      completeMission(mission.id, {
        hours: flightHours,
        miles: verification.flightDistanceNm,
        departureAirport: verification.departureAirport || mission.origin,
        arrivalAirport: mission.origin,
        rewardEligible: (verification.departureAirport || mission.origin) === mission.origin,
        ...careerLandingActual,
        notes: `MSFS 校验通过：已从 ${mission.origin} 起飞，抵达${mission.destination || "任务现场"}并返回基地${careerLanding?.runway ? `，跑道 ${careerLanding.runway}` : ""}。`
      });
      return;
    }
    setMissionStatus(mission, {
      phase: "returning",
      label: !isFreeMode() && onGround && airport?.airport.icao === mission.origin ? "正在确认着陆" : "返航中",
      detail: !isFreeMode() && onGround && airport?.airport.icao === mission.origin
        ? Boolean(careerLanding) && isSopMode() && !sopCanComplete
          ? sopCompletionPrompt(sop, sample)
          : "已检测到飞机返回基地接地，正在等待本次接地率和跑道数据。"
        : airport?.airport.icao && airport.airport.icao !== mission.origin
        ? `当前位于 ${airport.airport.icao}，请返回 ${mission.origin} 并落地。`
        : `请返回 ${mission.origin}，落地并将速度降到地面状态。`
    });
  }
  saveState();
  renderMissions();
  renderLogs();
  wireIcons();
}

async function pollSimulator() {
  try {
    const response = await fetch("/api/simulator/status", { cache: "no-store" });
    if (!response.ok) throw new Error("status unavailable");
    const payload = await response.json();
    lastSimulatorPayload = payload;
    lastTelemetry = payload.sample || null;
    lastTelemetryConnected = payload.connected;
    updateMonitor(payload);
    const fleetAircraft = payload.connected ? syncFleetTelemetry(payload.sample) : null;
    if (payload.connected && fleetAircraft) updateSimulatorFlight(payload.sample, fleetAircraft);
    const simulatorFlightAtLanding = normalizeSimulatorFlight(state.simulatorFlight);
    const landingWear = payload.connected && !isFreeMode() ? syncFleetLandingWear(payload.landing) : null;
    const crashLog = landingWear && isCrashLanding(landingWear)
      ? handleAircraftCrash(landingWear, payload.landing, payload.sample)
      : null;
    const actualFlightLog = landingWear && !crashLog
      ? finalizeSimulatorFlight(landingWear, payload.landing, payload.sample)
      : null;
    if (landingWear) {
      saveState();
      renderLogs();
      renderProfile();
      renderCompanyManagement();
      wireIcons();
      toast(crashLog
        ? `${landingWear.aircraft.name} 接地峰值 ${Number(landingWear.peakG).toFixed(2)}G，判定坠机，飞机已从机库删除`
        : actualFlightLog
        ? `${landingWear.aircraft.name} 实际飞行已记录，落地 ${landingWear.landingRateFpm} fpm，机况损耗 ${landingWear.wearPercent}%`
        : `${landingWear.aircraft.name} 落地 ${landingWear.landingRateFpm} fpm，机况损耗 ${landingWear.wearPercent}%`);
    }
    const bridgeFailed = !payload.connected && !payload.bridgeRunning && (payload.bridgeError || payload.bridgeExit);
    els.simulatorStatus.textContent = payload.connected ? "已连接" : bridgeFailed ? "连接失败" : payload.bridgeRunning ? "等待 MSFS" : "未连接";
    els.simulatorStatus.className = `tag ${payload.connected ? "good" : bridgeFailed ? "bad" : "warn"}`;
    els.simulatorAircraft.textContent = payload.connected
      ? (payload.sample.aircraftTitle || payload.sample.aircraftModel || "已连接 MSFS")
      : bridgeFailed ? (payload.bridgeError?.message || payload.bridgeExit?.message || "遥测桥启动失败") : "等待 Microsoft Flight Simulator";
    const airport = telemetryAirport(payload.sample);
    const heading = payload.sample ? aircraftHeading(payload.sample, telemetryMapPoint(payload.sample) || { lat: 0, lon: 0 }) : null;
    const displaySpeed = aircraftDisplaySpeed(payload.sample);
    els.simulatorPosition.textContent = payload.connected ? `${airport?.airport.icao || "空中"} · ${displaySpeed.label} ${Math.round(displaySpeed.value)} kt · 航向 ${String(Math.round(heading ?? 0)).padStart(3, "0")}° · ${payload.sample.onGround ? "地面" : "飞行中"}` : "未检测到飞行数据";
    const fuelKg = telemetryFuelKg(payload.sample);
    els.simulatorFuel.textContent = payload.connected && fuelKg !== null
      ? `实际燃油：${formatFuel(fuelKg)}${fleetAircraft ? ` · ${fleetAircraft.name}` : " · 未匹配机库"}`
      : "实际燃油：等待遥测";
    if (payload.connected && fleetAircraft && Date.now() - lastFleetTelemetryPersistAt >= 15_000) {
      lastFleetTelemetryPersistAt = Date.now();
      saveState();
    }
    if (state.activeView === "aircraft-management" && Date.now() - lastAircraftManagementRenderAt >= 2_000) {
      lastAircraftManagementRenderAt = Date.now();
      renderAircraftManagement();
    }
    const mission = activeVerifiedMission();
    if (payload.connected && mission?.verification?.flightPlanState === "waiting") {
      void syncMissionFlightPlan(mission);
    }
    if (mission?.verification?.flightPlanState && !["loaded", "prepared"].includes(mission.verification.flightPlanState)) {
      void pollFlightPlanStatus(mission);
    }
    els.simulatorMissionState.textContent = mission?.verification?.detail || "接受任务后将自动校验真实飞行。";
    const connectButton = document.getElementById("connectSimulatorBtn");
    if (connectButton && !connectButton.disabled) {
      connectButton.querySelector("span").textContent = payload.connected
        ? "已连接 MSFS"
        : payload.bridgeRunning ? "等待 MSFS" : "连接 MSFS";
    }
    if (state.activeView === "map") {
      if (payload.sample) updateLiveAircraftOnMap(payload.sample, payload.connected);
      updateCompanyAircraftOnMap();
    }
    if (payload.connected) {
      simulatorAutoConnectFailures = 0;
      processTelemetry(payload.sample, payload.landing, simulatorFlightAtLanding);
    } else if (mission?.verification) {
      setMissionStatus(mission, {
        phase: mission.verification.phase,
        label: "等待 MSFS 连接",
        detail: payload.bridgeError?.message || payload.bridgeExit?.message || "未连接 MSFS，软件会在检测到模拟器后自动连接。",
        voiceKey: "simulator-disconnected",
        voiceText: "未连接微软模拟飞行，请启动模拟器并连接 MSFS。",
        eventKey: "simulator-disconnected",
        eventTitle: "等待 MSFS 连接"
      });
      saveState();
      renderMissions();
      renderLogs();
      wireIcons();
    }
    renderSopMonitor();
    if (!payload.connected && !payload.bridgeRunning) void ensureSimulatorAutoConnection(payload);
    return payload;
  } catch (error) {
    els.simulatorStatus.textContent = "服务不可用";
    els.simulatorStatus.className = "tag bad";
    els.simulatorFuel.textContent = "实际燃油：服务不可用";
    lastSimulatorPayload = { connected: false, bridgeError: { message: "遥测服务不可用" } };
    updateMonitor(lastSimulatorPayload);
    renderSopMonitor();
    void reportRuntimeLog("error", "读取 MSFS 遥测失败", { error: error?.message || "unknown" });
    return null;
  }
}

let flightPlanStatusPromise = null;

async function pollFlightPlanStatus(mission) {
  if (!mission?.verification || flightPlanStatusPromise) return;
  flightPlanStatusPromise = (async () => {
    try {
      const response = await fetch("/api/simulator/flight-plan", { cache: "no-store" });
      const status = await response.json();
      if (status.missionId !== mission.id) return;
      const nextState = status.state || "connecting";
      const nextDetail = nextState === "loaded"
        ? "任务航路已加载到 MSFS 导航系统，任务点可在机内导航地图查看"
        : nextState === "prepared"
          ? status.message || "任务航路文件已安全生成"
        : nextState === "error"
          ? status.message || "MSFS 拒绝加载任务航路"
          : "正在等待 MSFS 确认任务航路";
      if (mission.verification.flightPlanState === nextState && mission.verification.flightPlanDetail === nextDetail) return;
      mission.verification.flightPlanState = nextState;
      mission.verification.flightPlanDetail = nextDetail;
      saveState();
      renderMissions();
      wireIcons();
    } catch {
      // The simulator bridge may still be starting; the next poll retries.
    }
  })().finally(() => { flightPlanStatusPromise = null; });
  await flightPlanStatusPromise;
}

async function requestSimulatorBridgeStart() {
  if (simulatorStartPromise) return simulatorStartPromise;
  simulatorStartPromise = (async () => {
    const response = await fetch("/api/simulator/start", { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.reason || "bridge-start-failed");
      error.result = result;
      throw error;
    }
    return result;
  })().finally(() => { simulatorStartPromise = null; });
  return simulatorStartPromise;
}

async function ensureSimulatorAutoConnection(payload = null) {
  if (payload?.connected || payload?.bridgeRunning || Date.now() < nextSimulatorAutoConnectAt) return false;
  nextSimulatorAutoConnectAt = Date.now() + 10_000;
  try {
    await requestSimulatorBridgeStart();
    simulatorAutoConnectFailures = 0;
    return true;
  } catch {
    simulatorAutoConnectFailures += 1;
    nextSimulatorAutoConnectAt = Date.now() + Math.min(60_000, 10_000 * (2 ** Math.min(3, simulatorAutoConnectFailures)));
    return false;
  }
}

async function connectSimulator() {
  const button = document.getElementById("connectSimulatorBtn");
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.querySelector("span").textContent = "正在连接...";
  }
  try {
    const result = await requestSimulatorBridgeStart();
    const startMessage = result.reason === "already-connected"
      ? "MSFS 遥测已经连接"
      : ["already-running", "external-running"].includes(result.reason)
        ? "遥测桥正在运行，等待 MSFS"
        : "已启动遥测桥，正在等待 MSFS SimConnect";
    toast(startMessage);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = await pollSimulator();
      if (status?.connected) {
        toast("MSFS 已连接");
        return;
      }
      if (status && !status.bridgeRunning && (status.bridgeError || status.bridgeExit)) {
        toast(status.bridgeError?.message || status.bridgeExit?.message || "遥测桥已退出，请确认 MSFS 已启动");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    toast("等待超时：请确认 MSFS 已进入飞行界面，再点击连接 MSFS");
  } catch (error) {
    toast(error?.result?.reason === "bridge-not-found" ? "未找到 MSFS 遥测桥，请重新打包软件" : "无法连接本地服务，请重启软件");
  } finally {
    if (button) {
      button.disabled = false;
      button.querySelector("span").textContent = "连接 MSFS";
    }
  }
}

function maybeAutoCreateMission() {
  autoRefreshMissions({ silent: true });
}

function autoRefreshMissions({ silent = true, rotateExpired = false, forceRefresh = false } = {}) {
  const generationBase = normalizeBaseCode(state?.pilot?.base);
  removeOpenMissionsOutsideBase();
  let added = 0;
  let removed = 0;
  let attempts = 0;

  if (forceRefresh) {
    const refreshableIds = new Set(refreshableMissionOffers().map((mission) => mission.id));
    if (refreshableIds.size) {
      state.missions = state.missions.filter((mission) => !refreshableIds.has(mission.id));
      removed += refreshableIds.size;
    }
  }

  let offers = refreshableMissionOffers();
  const expiredMission = rotateExpired ? oldestExpiredMission(offers) : null;
  if (expiredMission) {
    state.missions = state.missions.filter((mission) => mission.id !== expiredMission.id);
    removed += 1;
    offers = refreshableMissionOffers();
  }

  let emergencyCount = offers.filter(isEmergencyMission).length;
  const hasManagedHelicopter = state.fleet?.some((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented) && isHelicopterAircraft(aircraft)) === true;
  let hasHelicopterEmergency = offers.some(isHelicopterEmergencyMission);
  while ((emergencyCount < MISSION_EMERGENCY_TARGET_COUNT || (hasManagedHelicopter && !hasHelicopterEmergency)) && attempts < MISSION_OFFER_TARGET_COUNT * 2) {
    attempts += 1;
    if (offers.length >= MISSION_OFFER_TARGET_COUNT) {
      const replaceable = offers
        .filter((mission) => !isEmergencyMission(mission))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0];
      if (!replaceable) break;
      state.missions = state.missions.filter((mission) => mission.id !== replaceable.id);
      removed += 1;
      offers = refreshableMissionOffers();
    }
    const mission = makeEmergencyMission(
      hasManagedHelicopter && !hasHelicopterEmergency ? "helicopter" : "",
      generationBase
    );
    if (!mission) break;
    state.missions.unshift(mission);
    offers.unshift(mission);
    emergencyCount += 1;
    hasHelicopterEmergency ||= isHelicopterEmergencyMission(mission);
    added += 1;
  }

  attempts = 0;
  // Put the selected aircraft first so a manual refresh immediately produces
  // a mission from its actual last landing airport, even when the fleet has
  // more aircraft than the 50-offer pool can display.
  const selected = currentAircraft();
  const eligibleAircraft = [...missionEligibleAircraft()].sort((a, b) => {
    if (a.id === selected?.id) return -1;
    if (b.id === selected?.id) return 1;
    return 0;
  });
  const coveredAircraftIds = new Set(offers.flatMap((mission) => mission.permittedAircraftIds || []));
  for (const aircraft of eligibleAircraft) {
    if (offers.length >= MISSION_OFFER_TARGET_COUNT || coveredAircraftIds.has(aircraft.id)) continue;
    const categories = compatibleCategories(aircraft);
    const category = randomCategory(categories);
    const mission = makeMission(category, randomSubtype(category), 0, aircraft, generationBase);
    if (!mission) continue;
    mission.permittedAircraftIds = [aircraft.id];
    mission.aircraftHint = aircraft.name;
    state.missions.unshift(mission);
    offers.unshift(mission);
    coveredAircraftIds.add(aircraft.id);
    added += 1;
  }
  while (offers.length < MISSION_OFFER_TARGET_COUNT && attempts < MISSION_OFFER_TARGET_COUNT * 4) {
    attempts += 1;
    const aircraft = pick(eligibleAircraft) || currentAircraft();
    const category = randomCategory(compatibleCategories(aircraft));
    const mission = makeMission(category, randomSubtype(category), 0, aircraft, generationBase);
    if (!mission) continue;
    mission.permittedAircraftIds = [aircraft.id];
    mission.aircraftHint = aircraft.name;
    state.missions.unshift(mission);
    offers.unshift(mission);
    added += 1;
  }
  if (!added && !removed) return 0;
  saveState();
  renderMissions();
  renderProfile();
  wireIcons();
  if (!silent) toast(`任务列表已刷新，当前提供 ${refreshableMissionOffers().length} 个任务`);
  return added;
}

function readBackups() {
  return Array.isArray(backupCache) ? backupCache : [];
}

function writeBackup(reason) {
  backupCache.unshift({
    id: cryptoId("backup"),
    reason,
    createdAt: Date.now(),
    state: JSON.stringify(state)
  });
  backupCache = backupCache.slice(0, 8);
  backupWriteChain = backupWriteChain
    .catch(() => {})
    .then(async () => {
      await writeStorageValue(BACKUP_KEY, await encryptSaveText(JSON.stringify(backupCache)));
    })
    .catch((error) => {
      saveStorageError = error;
    });
  return backupWriteChain;
}

async function hydrateBackups() {
  const raw = await readStorageValue(BACKUP_KEY);
  if (!raw) {
    backupsHydrated = true;
    return;
  }
  try {
    const decoded = await decodeSavePayload(raw);
    backupCache = Array.isArray(decoded.value) ? decoded.value : [];
    backupsHydrated = true;
    if (decoded.legacy) {
      backupWriteChain = backupWriteChain.then(async () => {
        await writeStorageValue(BACKUP_KEY, await encryptSaveText(JSON.stringify(backupCache)));
      });
      await backupWriteChain;
    }
  } catch (error) {
    // Do not expose or silently accept a modified backup chain.
    backupCache = [];
    backupsHydrated = true;
    saveStorageError ||= error;
  }
}

function createManualBackup() {
  writeBackup("手动备份");
  toast("已创建本地备份");
  renderBackups();
  wireIcons();
}

async function restoreBackup(id) {
  const backup = readBackups().find((item) => item.id === id);
  if (!backup) {
    toast("备份不存在或已被清理");
    return;
  }
  if (!await showConfirmDialog(`恢复“${backup.reason}”吗？当前进度会先自动备份。`)) return;
  try {
    const restored = JSON.parse(backup.state);
    writeBackup("恢复备份前");
    Object.assign(state, mergeState(defaultState(), restored));
    toast("备份已恢复");
    renderAll();
  } catch {
    toast("备份数据损坏，无法恢复");
  }
}

function airlineFromCode(code) {
  return airlines.find((airline) => code.startsWith(airline.code) || airline.code.startsWith(code));
}

function estimateDistance(from, to, duration) {
  const seed = [...`${from}${to}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const cruise = 210 + (seed % 180);
  return Math.max(80, Math.round(duration * cruise));
}

function randomCategory(allowed = compatibleCategories()) {
  const categories = allowed.length ? allowed : ["包机"];
  const weights = categories.map((category) => ({ 客运: 0.28, 货运: 0.18, 包机: 0.14, 医疗: 0.14, 搜救: 0.1, 海上救援: 0.09, 事故调查: 0.07 }[category] || 0.1));
  return pick(categories, weights);
}

function randomSubtype(category) {
  return pick(missionPools[category] || missionPools.客运, [0.35, 0.25, 0.2, 0.2]);
}

function makeEmergencyMission(preferredKind = "", baseOverride = "") {
  const managedFleet = missionEligibleAircraft();
  const categoryOptions = emergencyMissionCategories.map((category) => ({
    category,
    aircraft: managedFleet.filter((aircraft) => isAircraftCompatible(category, aircraft) && (preferredKind !== "helicopter" || isHelicopterAircraft(aircraft)))
  })).filter((option) => option.aircraft.length);
  if (!categoryOptions.length) return null;

  const option = pick(categoryOptions);
  const selected = currentAircraft();
  const aircraft = option.aircraft.find((candidate) => candidate.id === selected.id) || pick(option.aircraft);
  const mission = makeMission(option.category, randomSubtype(option.category), 0, aircraft, baseOverride);
  if (!mission) return null;
  const origin = normalizeBaseCode(mission.origin);
  const sameAirportAircraft = option.aircraft.filter((candidate) => normalizeBaseCode(aircraftOperationalBase(candidate)) === origin);
  const permittedAircraft = sameAirportAircraft.length ? sameAirportAircraft : [aircraft];
  mission.permittedAircraftIds = permittedAircraft.map((candidate) => candidate.id);
  mission.aircraftHint = permittedAircraft.slice(0, 3).map((candidate) => candidate.name).join(" / ");
  mission.priority = "emergency";
  return mission;
}

function maybeAutoUnlockAircraft() {
  state.fleet.forEach((aircraft) => {
    if (aircraft.unlockHours === 0) return;
    if (state.stats.totalHours >= aircraft.unlockHours && !aircraft.owned && !aircraft.rented) {
      // show as available only; no auto-grant
    }
  });
}

async function deleteMission(id) {
  const mission = state.missions.find((item) => item.id === id);
  if (!mission || endingMissionIds.has(id)) return;
  const active = mission.status === "accepted";
  const completed = mission.status === "completed";
  const message = active
    ? `确定删除执行中任务“${mission.title}”吗？当前任务进度会被清除，且不会获得奖励。`
    : completed
      ? `确定删除已完成任务“${mission.title}”吗？任务卡和任务日志会被移除，飞行日志仍会保留。`
      : `确定删除任务“${mission.title}”吗？删除后不能再次接取。`;
  if (!await showConfirmDialog(message)) return;
  endingMissionIds.add(id);
  try {
    if (activeVerifiedMission()?.id === mission.id) {
      await fetch("/api/simulator/scene", { method: "DELETE" }).catch(() => {});
      await fetch("/api/simulator/flight-plan", { method: "DELETE" }).catch(() => {});
    }
    state.missions = state.missions.filter((item) => item.id !== id);
    state.taskEvents = state.taskEvents.filter((event) => event.missionId !== id);
    state.schedules = state.schedules.filter((record) => record.missionId !== id);
    if (state.simulatorFlight?.missionId === id) {
      state.simulatorFlight = { ...state.simulatorFlight, missionId: "" };
    }
    const license = state.licenses.find((record) => record.assessmentMissionId === id);
    if (license && !license.assessmentCompleted) license.assessmentMissionId = "";
    saveState();
    toast(completed ? "已删除任务，飞行日志已保留" : active ? "执行中任务已删除" : "任务已删除");
    renderAll();
  } finally {
    endingMissionIds.delete(id);
  }
}

function buyAircraft(id) {
  const template = aircraftCatalog.find((aircraft) => aircraft.id === id);
  if (!template) return;
  if (!isFreeMode() && state.stats.totalHours < template.unlockHours) {
    toast(`需要 ${template.unlockHours} 小时后解锁`);
    return;
  }
  if (state.cash < template.price) {
    toast("资金不足");
    return;
  }
  const aircraft = createPersonalAircraft(template.id, "owned");
  if (!aircraft) return;
  recordFundTransaction({
    amount: -template.price,
    type: "aircraft-purchase",
    title: "购买飞机",
    detail: `${template.name} · 机队编号 ${aircraftFleetNumber(aircraft)}`,
    referenceId: aircraft.id
  });
  state.fleet.push(aircraft);
  selectAircraft(aircraft.id);
  toast(`已购买 ${aircraft.name}，已加入飞机管理`);
  renderAll();
}

function rentAircraft(id) {
  const template = aircraftCatalog.find((aircraft) => aircraft.id === id);
  if (!template) return;
  if (!isFreeMode() && state.stats.totalHours < template.unlockHours) {
    toast(`需要 ${template.unlockHours} 小时后解锁`);
    return;
  }
  if (state.cash < template.rent) {
    toast("租金不足");
    return;
  }
  const aircraft = createPersonalAircraft(template.id, "rented");
  if (!aircraft) return;
  recordFundTransaction({
    amount: -template.rent,
    type: "aircraft-rental",
    title: "租赁飞机",
    detail: `${template.name} · 机队编号 ${aircraftFleetNumber(aircraft)}`,
    referenceId: aircraft.id
  });
  state.fleet.push(aircraft);
  selectAircraft(aircraft.id);
  toast(`已租赁 ${aircraft.name}，已加入飞机管理`);
  renderAll();
}

function returnAircraft(id) {
  const aircraft = state.fleet.find((item) => item.id === id);
  if (!aircraft || !aircraft.rented || isCompanyAircraft(aircraft)) return;
  if (aircraftHasActiveMission(aircraft)) {
    toast("执行任务期间不能归还飞机");
    return;
  }
  state.fleet = state.fleet.filter((item) => item.id !== id);
  ensureSelectedPersonalAircraft();
  toast(`已归还 ${aircraft.name}`);
  renderAll();
}

function aircraftResaleRate(aircraft) {
  const condition = aircraftCondition(aircraft);
  // A new aircraft returns 42% of list price. Wear lowers the return value to
  // 15% at zero condition, making maintenance meaningful before resale.
  return +(0.15 + condition / 100 * 0.27).toFixed(3);
}

function aircraftResaleValue(aircraft) {
  return Math.max(0, Math.round(Number(aircraft?.price || 0) * aircraftResaleRate(aircraft)));
}

async function sellAircraft(id) {
  const aircraft = state.fleet.find((item) => item.id === id);
  if (!aircraft || !aircraft.owned || (!isCompanyAircraft(aircraft) && isStarterAircraft(aircraft.id))) return;
  if (isCompanyAircraft(aircraft) && !companyHangarIsActive()) return;
  if (aircraftHasActiveMission(aircraft)) {
    toast("执行任务期间不能出售飞机");
    return;
  }
  const condition = aircraftCondition(aircraft);
  const resale = aircraftResaleValue(aircraft);
  const rate = Math.round(aircraftResaleRate(aircraft) * 100);
  const accountLabel = isCompanyAircraft(aircraft) ? "公司账户" : "个人账户";
  if (!await showConfirmDialog(`确定出售 ${aircraft.name}（机队编号 ${aircraftFleetNumber(aircraft)}）吗？当前机况 ${condition.toFixed(1)}%，预计回收 ${formatMoney(resale)}（新机价 ${formatMoney(aircraft.price)} 的 ${rate}%），款项将计入${accountLabel}。出售后无法撤销。`)) return;
  if (companyHangarIsActive()) {
    companyTransaction({ amount: resale, type: "aircraft-sale", title: "出售公司飞机", detail: aircraft.name, referenceId: aircraft.id });
  } else {
    recordFundTransaction({ amount: resale, type: "aircraft-sale", title: "出售飞机", detail: aircraft.name, referenceId: aircraft.id });
  }
  if (isCompanyAircraft(aircraft)) {
    state.company.aircraftIds = (state.company.aircraftIds || []).filter((aircraftId) => aircraftId !== id);
  }
  state.fleet = state.fleet.filter((item) => item.id !== id);
  ensureSelectedPersonalAircraft();
  toast(`已出售 ${aircraft.name}（${aircraftFleetNumber(aircraft)}），回收 ${formatMoney(resale)}`);
  renderAll();
}

function selectAircraft(id) {
  if (isCompanyAircraft(state.fleet.find((aircraft) => aircraft.id === id))) return;
  state.fleet.forEach((aircraft) => {
    aircraft.selected = !isCompanyAircraft(aircraft) && aircraft.id === id;
  });
}

function ensureSelectedPersonalAircraft() {
  const managedFleet = state.fleet.filter((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented));
  if (!managedFleet.length || managedFleet.some((aircraft) => aircraft.selected)) return;
  selectAircraft(managedFleet[0].id);
}

async function refuelAircraft(id) {
  const aircraft = state.fleet.find((item) => item.id === id);
  const liveAircraft = lastTelemetryConnected ? telemetryFleetAircraft(lastTelemetry) : null;
  if (!aircraft || liveAircraft?.id !== id) {
    toast("请先在 MSFS 切换到这架飞机");
    return;
  }
  if (!telemetryBoolean(lastTelemetry?.onGround)) {
    toast("飞机必须停在地面才能加注燃油");
    return;
  }
  if (telemetryBoolean(lastTelemetry?.engineRunning)) {
    toast("请先关闭发动机再加注燃油");
    return;
  }
  const capacityKg = telemetryFuelCapacityKg(lastTelemetry) || aircraft.fuelCapacityKg;
  const currentFuelKg = telemetryFuelKg(lastTelemetry);
  if (!(Number(capacityKg) > 0) || currentFuelKg === null) {
    toast("尚未读取到 MSFS 油箱容量");
    return;
  }
  const currentPercent = currentFuelKg / Number(capacityKg) * 100;
  const targetPercent = Math.max(0, Math.min(100, Number(fuelTargetPercents.get(id)) || 0));
  if (targetPercent <= currentPercent + 0.1) {
    toast("请将滑块调到高于当前油量");
    return;
  }
  refuelPendingIds.add(id);
  renderAircraftManagement();
  wireIcons();
  try {
    const response = await fetch("/api/simulator/fuel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ aircraftId: id, targetPercent })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "MSFS 拒绝加注燃油");
    if (result.state === "applied") {
      aircraft.lastFuelKg = +(Number(capacityKg) * targetPercent / 100).toFixed(2);
      aircraft.lastFuelAt = Date.now();
    }
    fuelTargetPercents.delete(id);
    fuelTargetBaselines.delete(id);
    toast(result.message || `已发送加注至 ${targetPercent.toFixed(0)}% 的命令`);
  } catch (error) {
    toast(error?.message || "加注燃油失败");
  } finally {
    refuelPendingIds.delete(id);
    saveState();
    renderAircraftManagement();
    wireIcons();
  }
}

function repairAircraft(id) {
  const aircraft = state.fleet.find((item) => item.id === id);
  if (!aircraft || (!aircraft.owned && !aircraft.rented)) return;
  if (aircraftHasActiveMission(aircraft)) {
    toast("执行任务期间不能维修飞机");
    return;
  }
  const cost = aircraftMaintenanceCost(aircraft);
  if (cost <= 0) {
    toast("飞机状态良好，无需维修");
    return;
  }
  const useCompanyFunds = companyHangarIsActive();
  const availableFunds = useCompanyFunds ? state.company.funds : state.cash;
  if (availableFunds < cost) {
    toast("余额不足，无法完成维修");
    return;
  }
  if (useCompanyFunds) {
    companyTransaction({ amount: -cost, type: "maintenance-expense", title: "公司飞机维修", detail: aircraft.name, referenceId: aircraft.id });
  } else {
    recordFundTransaction({ amount: -cost, type: "maintenance-expense", title: "飞机维修", detail: aircraft.name, referenceId: aircraft.id });
  }
  aircraft.conditionPercent = 100;
  aircraft.lastMaintenanceAt = Date.now();
  toast(`已完成 ${aircraft.name} 维修，支出 ${formatMoney(cost)}`);
  renderAll();
}

function createCompany() {
  if (state.company?.created) return;
  if (!canCreateCompany()) {
    toast(companyCreationRequirementText());
    return;
  }
  const airlineCode = normalizeAirlineCode(document.getElementById("companyNameInput")?.value || currentAirline().code);
  const airline = airlines.find((item) => item.code === airlineCode);
  if (!airline) {
    toast("请输入有效的三字航空公司代码");
    return;
  }
  const airlineId = airline.id;
  const name = airline.name;
  const base = normalizeAirportInputCode(document.getElementById("companyBaseInput")?.value || state.pilot.base);
  const funds = Math.round(Number(document.getElementById("companyFundsInput")?.value) || 0);
  const aircraftId = String(document.getElementById("companyAircraftSelect")?.value || "");
  const starterAircraft = aircraftCatalog.find((aircraft) => aircraft.id === aircraftId && aircraft.kind === "干线喷气");
  if (!/^[A-Z]{4}$/.test(base) || !companyAirportByIcao(base)) {
    toast("请输入有效的四位英文字母 ICAO 公司基地");
    return;
  }
  if (funds < COMPANY_STARTUP_FUNDS_MIN) {
    toast(`启动资金最低为 ${formatMoney(COMPANY_STARTUP_FUNDS_MIN)}`);
    return;
  }
  if (funds > COMPANY_STARTUP_FUNDS_MAX) {
    toast(`启动资金最多为 ${formatMoney(COMPANY_STARTUP_FUNDS_MAX)}`);
    return;
  }
  if (funds > Number(state.cash || 0)) {
    toast("个人账户资金不足以注资公司");
    return;
  }
  if (!starterAircraft) {
    toast("请选择公司初始飞机");
    return;
  }
  const companyAircraft = createCompanyAircraft(starterAircraft.id);
  state.company = {
    created: true,
    name,
    airlineId: airline.id,
    base,
    funds: 0,
    pilots: [createCompanyPilot({ name: state.pilot.name || "公司负责人", skillLevel: 3, skill: 72, aircraftKind: "训练机", salary: 0, experienceHours: state.stats.totalHours }, true)],
    applicants: companyApplicants(),
    taskOffers: [],
    tasks: [],
    flightLogs: [],
    aircraftIds: companyAircraft ? [companyAircraft.id] : [],
    starterAircraftGranted: Boolean(companyAircraft),
    transactions: [],
    activeSection: "management"
  };
  if (companyAircraft) state.fleet.push(companyAircraft);
  state.company.taskOffers = Array.from({ length: COMPANY_TASK_OFFER_COUNT }, () => companyMissionOffer());
  recordFundTransaction({ amount: -funds, type: "company-investment", title: "公司注资", detail: `${name} · ${base}`, referenceId: `company-${airline.id}` });
  companyTransaction({ amount: funds, type: "company-investment", title: "公司启动资金", detail: `个人账户注资 · ${base}`, referenceId: `company-${airline.id}` });
  companyManagedFleet();
  saveState();
  renderAll();
  toast(`已创建 ${name}`);
}

async function closeCompany() {
  if (!state.company?.created) return;
  const companyName = String(state.company.name || "当前公司");
  if (!await showConfirmDialog(`确定关闭“${companyName}”吗？公司资金、任务、飞行员、招聘名单、公司流水和公司机库关联都会被清除，个人飞机和个人飞行记录保留。`)) return;
  writeBackup(`关闭公司前：${companyName}`);
  state.fleet = state.fleet.filter((aircraft) => !isCompanyAircraft(aircraft));
  if (!state.fleet.some((aircraft) => aircraft.selected)) selectAircraft("c172");
  const personalAirlineId = airlines.some((airline) => airline.id === state.airlineId) ? state.airlineId : airlines[0].id;
  state.company = {
    created: false,
    name: "",
    airlineId: personalAirlineId,
    base: normalizeBaseCode(state.pilot.base || "ZBAA"),
    funds: 0,
    pilots: [],
    applicants: [],
    taskOffers: [],
    tasks: [],
    flightLogs: [],
    aircraftIds: [],
    starterAircraftGranted: false,
    transactions: [],
    activeSection: "management"
  };
  saveState();
  renderAll();
  toast(`已关闭 ${companyName}，公司数据已清除`);
}

function refreshCompanyApplicants() {
  if (!state.company?.created) return;
  state.company.applicants = companyApplicants();
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast("招聘名单已刷新");
}

function refreshCompanyTasks() {
  if (!state.company?.created) return;
  state.company.taskOffers = [];
  while (state.company.taskOffers.length < COMPANY_TASK_OFFER_COUNT) state.company.taskOffers.push(companyMissionOffer());
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast("公司任务池已刷新");
}

function hireCompanyPilot(id) {
  if (!state.company?.created) return;
  const applicantIndex = state.company.applicants.findIndex((item) => item.id === id);
  const applicant = state.company.applicants[applicantIndex];
  if (!applicant) return;
  if (state.company.funds < applicant.hirePrice) {
    toast("公司资金不足，无法雇佣");
    return;
  }
  const pilot = createCompanyPilot(applicant);
  companyTransaction({ amount: -applicant.hirePrice, type: "pilot-hiring", title: "雇佣飞行员", detail: `${pilot.name} · ${pilotAircraftKinds(pilot).join("、")}`, referenceId: pilot.id });
  state.company.pilots.push(pilot);
  state.company.applicants.splice(applicantIndex, 1);
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast(`已雇佣 ${pilot.name}`);
}

function upgradeCompanyPilot(id) {
  if (!state.company?.created) return;
  const pilot = state.company.pilots.find((item) => item.id === id && item.status !== "fired");
  if (!pilot || pilot.skillLevel >= 5) return;
  const cost = companyPilotUpgradeCost(pilot);
  if (state.company.funds < cost) {
    toast("公司资金不足，无法提升技术水平");
    return;
  }
  companyTransaction({ amount: -cost, type: "pilot-training", title: "飞行员技术培训", detail: `${pilot.name} · 等级 ${pilot.skillLevel} → ${pilot.skillLevel + 1}`, referenceId: pilot.id });
  pilot.skillLevel += 1;
  pilot.skill = Math.min(100, Number(pilot.skill || 0) + 8);
  pilot.salary = Number(pilot.salary || 0) + 120;
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast(`${pilot.name} 技术等级提升至 ${pilot.skillLevel}`);
}

function fireCompanyPilot(id) {
  if (!state.company?.created) return;
  const pilot = state.company.pilots.find((item) => item.id === id);
  if (!pilot || pilot.owner || pilot.assignedTaskId) return;
  pilot.status = "fired";
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast(`已解雇 ${pilot.name}`);
}

function createCompanyFlightLog(task, overrides = {}) {
  if (!state.company?.created || !task) return null;
  if (!Array.isArray(state.company.flightLogs)) state.company.flightLogs = [];
  const pilot = state.company.pilots.find((item) => item.id === task.pilotId);
  const aircraft = state.fleet.find((item) => item.id === task.aircraftId);
  const log = {
    id: cryptoId("company-flight"),
    taskId: task.id,
    title: String(task.title || "公司航班任务"),
    origin: normalizeBaseCode(task.origin),
    destination: normalizeBaseCode(task.destination) || String(task.destination || "任务现场"),
    pilotId: task.pilotId,
    pilotName: pilot?.name || "未分配飞行员",
    aircraftId: task.aircraftId,
    aircraftName: aircraft?.name || "未分配飞机",
    status: "assigned",
    airportCheck: "pending",
    assignedAt: task.assignedAt || Date.now(),
    createdAt: Date.now(),
    ...overrides
  };
  state.company.flightLogs.unshift(log);
  state.company.flightLogs = state.company.flightLogs.slice(0, 300);
  task.flightLogId = log.id;
  return log;
}

function updateCompanyFlightLog(task, changes = {}) {
  if (!task) return null;
  const log = state.company?.flightLogs?.find((item) => item.id === task.flightLogId || item.taskId === task.id);
  if (!log) return createCompanyFlightLog(task, changes);
  Object.assign(log, changes);
  return log;
}

function dispatchCompanyTask(missionId) {
  if (!state.company?.created) return;
  const mission = state.company.taskOffers.find((item) => item.id === missionId && item.status === "open");
  if (!mission) {
    toast("任务已不可派遣");
    return;
  }
  const pilotSelect = document.querySelector(`[data-company-pilot-for="${missionId}"]`);
  const aircraftSelect = document.querySelector(`[data-company-aircraft-for="${missionId}"]`);
  const pilot = state.company.pilots.find((item) => item.id === pilotSelect?.value && item.status === "active");
  const aircraft = companyManagedFleet().find((item) => item.id === aircraftSelect?.value);
  if (!pilot || !aircraft) {
    toast("请选择飞行员和飞机");
    return;
  }
  if (pilot.assignedTaskId) {
    toast("该飞行员已有派遣任务");
    return;
  }
  if (!pilotCanOperateAircraft(pilot, aircraft)) {
    toast(`${pilot.name} 不具备 ${aircraft.name} 的操作资格`);
    return;
  }
  const task = {
    id: cryptoId("company-task"),
    missionId: mission.id,
    title: mission.title,
    origin: aircraftOperationalBase(aircraft, mission.origin || state.company.base),
    destination: mission.destination || mission.site?.name || "任务现场",
    distance: mission.distance,
    pilotId: pilot.id,
    aircraftId: aircraft.id,
    payout: mission.payout,
    status: "assigned",
    assignedAt: Date.now()
  };
  state.company.tasks.unshift(task);
  createCompanyFlightLog(task);
  mission.status = "assigned";
  pilot.assignedTaskId = task.id;
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast(`已将任务派遣给 ${pilot.name}`);
}

function refreshCompanyMissionFromAircraft(aircraft) {
  if (!state.company?.created || !aircraft || !isCompanyAircraft(aircraft)) return null;
  if (!Array.isArray(state.company.taskOffers)) state.company.taskOffers = [];
  const origin = aircraftOperationalBase(aircraft, state.company.base);
  const existing = state.company.taskOffers.find((offer) => offer.status === "open"
    && normalizeBaseCode(offer.origin) === normalizeBaseCode(origin)
    && (!offer.aircraftId || offer.aircraftId === aircraft.id));
  if (existing) return existing;
  const offer = companyMissionOffer(aircraft);
  state.company.taskOffers.unshift(offer);
  const openOffers = state.company.taskOffers.filter((item) => item.status === "open");
  if (openOffers.length > COMPANY_TASK_OFFER_COUNT) {
    const excess = openOffers
      .slice(COMPANY_TASK_OFFER_COUNT)
      .map((item) => item.id);
    state.company.taskOffers = state.company.taskOffers.filter((item) => !excess.includes(item.id));
  }
  return offer;
}

function completeCompanyTask(id) {
  if (!state.company?.created) return;
  const task = state.company.tasks.find((item) => item.id === id && item.status === "assigned");
  if (!task) return;
  task.status = "completed";
  task.completedAt = Date.now();
  const actualLog = [...state.logs].reverse().find((log) => log.source === "msfs" && log.aircraftId === task.aircraftId && Number(log.date || 0) >= Number(task.assignedAt || 0));
  const departureAirport = normalizeBaseCode(actualLog?.departureAirport || actualLog?.from || task.origin);
  const arrivalAirport = normalizeBaseCode(actualLog?.arrivalAirport || actualLog?.to || task.destination);
  const departureMatches = Boolean(departureAirport && normalizeBaseCode(task.origin) && departureAirport === normalizeBaseCode(task.origin));
  const arrivalMatches = Boolean(arrivalAirport && normalizeBaseCode(task.destination) && arrivalAirport === normalizeBaseCode(task.destination));
  const airportCheck = actualLog ? (departureMatches && arrivalMatches ? "passed" : "failed") : "pending";
  task.departureAirport = departureAirport;
  task.arrivalAirport = arrivalAirport;
  task.airportCheck = airportCheck;
  updateCompanyFlightLog(task, {
    status: airportCheck === "failed" ? "airport-mismatch" : "completed",
    completedAt: task.completedAt,
    departureAirport,
    arrivalAirport,
    airportCheck,
    landingRateFpm: actualLog?.landingRateFpm ?? null,
    landingPeakG: actualLog?.landingPeakG ?? null
  });
  const pilot = state.company.pilots.find((item) => item.id === task.pilotId);
  const companyAircraft = state.fleet.find((item) => item.id === task.aircraftId);
  if (companyAircraft && arrivalAirport) {
    companyAircraft.lastLandingAirport = arrivalAirport;
  }
  if (typeof refreshCompanyMissionFromAircraft === "function") refreshCompanyMissionFromAircraft(companyAircraft);
  if (pilot) {
    pilot.assignedTaskId = "";
    pilot.experienceHours = +(Number(pilot.experienceHours || 0) + Math.max(0.5, Number(task.distance || 0) / 160)).toFixed(1);
  }
  companyTransaction({ amount: task.payout, type: "company-mission-income", title: "公司任务收入", detail: task.title, referenceId: task.id });
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast(`公司任务完成，收入 ${formatMoney(task.payout)}`);
}

function handleAircraftManagementInput(event) {
  const slider = event.target.closest('[data-action="fuel-target"]');
  if (!slider) return;
  const { id } = slider.dataset;
  const minimumPercent = Number(slider.dataset.minimum || 0);
  const targetPercent = Math.max(minimumPercent, Math.min(100, Number(slider.value) || 0));
  slider.value = String(targetPercent);
  fuelTargetPercents.set(id, targetPercent);
  fuelTargetBaselines.set(id, minimumPercent);
  const prefix = String(slider.dataset.controlPrefix || "").trim();
  const output = document.getElementById(`fuelTarget-${prefix ? `${prefix}-` : ""}${id}`);
  if (output) output.textContent = `${targetPercent.toFixed(0)}%`;
  const button = document.querySelector(`[data-action="refuel-aircraft"][data-id="${id}"][data-control-prefix="${CSS.escape(prefix)}"]`);
  if (button) button.disabled = targetPercent <= Number(slider.dataset.minimum || 0);
}

function manualLog(prefill = {}) {
  logMode = "manual";
  els.logModalTitle.textContent = "记录航段";
  els.logForm.dataset.mode = "manual";
  els.logFrom.value = prefill.from || state.pilot.base;
  els.logTo.value = prefill.to || "";
  els.logAircraft.value = prefill.aircraft || currentAircraft().name;
  els.logHours.value = prefill.hours || 1.2;
  els.logMiles.value = prefill.miles || 180;
  els.logIncome.value = prefill.income || 2400;
  els.logNotes.value = prefill.notes || "";
  els.logModal.showModal();
}

function saveManualLog() {
  const from = els.logFrom.value.trim().toUpperCase();
  const to = els.logTo.value.trim().toUpperCase();
  const aircraftName = els.logAircraft.value.trim();
  const hours = Number(els.logHours.value);
  const miles = Number(els.logMiles.value);
  const income = Number(els.logIncome.value);
  if (!from || !to || !aircraftName) return;
  const aircraft = state.fleet.find((item) => item.name === aircraftName) || currentAircraft();
  state.logs.unshift({
    id: cryptoId("log"),
    date: Date.now(),
    from,
    to,
    aircraftId: aircraft.id,
    aircraftName: aircraft.name,
    hours,
    miles,
    income,
    notes: els.logNotes.value.trim()
  });
  recordFundTransaction({
    amount: income,
    type: income >= 0 ? "manual-income" : "manual-expense",
    title: income >= 0 ? "手动航段收入" : "手动航段支出",
    detail: `${from} → ${to} · ${aircraft.name}`,
    referenceId: state.logs[0].id
  });
  state.stats.totalHours += hours;
  state.stats.totalMiles += miles;
  state.stats.totalLandings += 2;
  state.stats.manualLogs += 1;
  state.reputation += Math.max(1, Math.round(hours / 2));
  toast("航段已记录");
  maybeAutoCreateMission();
  renderAll();
}

function loginPilot() {
  state.pilot.loggedIn = false;
  els.pilotNameInput.value = String(state.pilot.name || "").replace(/\D/g, "").slice(0, 32);
  els.pilotBaseInput.value = normalizeAirportInputCode(state.pilot.base || "");
  renderAvatar(els.pilotAvatarPreview, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
  renderAvatarChoices();
  els.loginGate.hidden = false;
  els.appShell.hidden = true;
  document.body.classList.add("auth-only");
  window.desktopApp?.setWindowMode("login");
  window.setTimeout(() => els.pilotNameInput.focus(), 0);
}

function enterSystem() {
  els.loginGate.hidden = true;
  els.appShell.hidden = false;
  document.body.classList.remove("auth-only");
  window.desktopApp?.setWindowMode("system");
}

function logoutPilot() {
  state.pilot.loggedIn = false;
  saveState();
  renderProfile();
  wireIcons();
  loginPilot();
}

function togglePilotLogin() {
  if (state.pilot.loggedIn) logoutPilot();
  else loginPilot();
}

async function savePilot() {
  const previousBase = normalizeBaseCode(state.pilot.base);
  const name = String(els.pilotNameInput.value || "").replace(/\D/g, "").slice(0, 32);
  const base = normalizeAirportInputCode(els.pilotBaseInput.value);
  if (!/^\d{2,32}$/.test(name)) {
    toast("飞行员呼号只能输入 2 至 32 位数字");
    return false;
  }
  if (!/^[A-Z]{4}$/.test(base)) {
    toast("机场代码只能输入四位英文字母");
    return false;
  }
  if (!companyAirportByIcao(base)) {
    toast("请输入有效的四字 ICAO 机场代码");
    return false;
  }
  els.pilotNameInput.value = name;
  els.pilotBaseInput.value = base;
  state.pilot.name = name;
  state.pilot.base = base;
  state.pilot.loggedIn = true;
  state.pilot.hasCompletedLogin = true;
  if (state.pilot.base !== previousBase) {
    const removed = removeOpenMissionsOutsideBase(state.pilot.base);
    const added = autoRefreshMissions({ silent: true, forceRefresh: true });
    saveState();
    toast(`基地已切换至 ${state.pilot.base}，已生成周边任务`);
  } else {
    toast("飞行员档案已保存");
  }
  await saveState();
  enterSystem();
  renderAll();
  return true;
}

function generateMission() {
  const category = randomCategory();
  const mission = makeMission(category, randomSubtype(category));
  if (!mission) {
    toast("当前基地周边暂时没有符合条件的任务");
    return;
  }
  state.missions.unshift(mission);
  toast("已生成新任务");
  renderAll();
}

function makeSceneMission(category, subtype = randomSubtype(category), offsetHours = 0) {
  const compatibleAircraft = state.fleet
    .filter((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented) && isAircraftCompatible(category, aircraft))
    .sort((a, b) => Number(a.unlockHours || 0) - Number(b.unlockHours || 0));
  const selected = currentAircraft();
  const missionAircraft = compatibleAircraft.find((aircraft) => aircraft.id === selected.id)
    || compatibleAircraft.find((aircraft) => aircraft.owned || aircraft.rented)
    || compatibleAircraft[0];
  if (!missionAircraft) return null;
  const mission = makeMission(category, subtype, offsetHours, missionAircraft);
  if (!mission) return null;
  mission.permittedAircraftIds = compatibleAircraft.map((aircraft) => aircraft.id);
  mission.aircraftHint = compatibleAircraft.slice(0, 3).map((aircraft) => aircraft.name).join(" / ");
  return mission;
}

function generateSceneMission() {
  const sceneCategories = ["搜救", "海上救援", "事故调查"];
  const lastCategory = state.features?.lastSceneCategory;
  const categoryIndex = lastCategory ? (sceneCategories.indexOf(lastCategory) + 1) % sceneCategories.length : 0;
  const category = sceneCategories[categoryIndex];
  const previousSubtype = state.features?.lastSceneSubtype;
  const subtypePool = (missionPools[category] || []).filter((subtype) => subtype !== previousSubtype);
  const subtype = pick(subtypePool.length ? subtypePool : missionPools[category]);
  const mission = makeSceneMission(category, subtype);
  if (!mission) {
    const hasCompatibleAircraft = state.fleet.some((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented) && isAircraftCompatible(category, aircraft));
    toast(hasCompatibleAircraft ? "基地周边暂时没有可用任务点，请稍后重试" : `${category}暂时没有适配机型`);
    return;
  }
  state.missions.unshift(mission);
  state.features = { ...(state.features || {}), lastSceneCategory: category, lastSceneSubtype: subtype };
  state.missionFilters = { search: "", status: "all", category };
  toast(`已生成 ${category}：${subtype}`);
  renderAll();
}

async function exportSave() {
  const encrypted = await encryptSaveText(JSON.stringify(state));
  const blob = new Blob([encrypted], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `flight-career-save-${new Date().toISOString().slice(0, 10)}.fcm`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("加密存档已导出");
}

async function importSave(file) {
  const text = await file.text();
  const decoded = await decodeSavePayload(text);
  const merged = mergeState(defaultState(), decoded.value);
  writeBackup(`导入存档前：${file.name}`);
  Object.assign(state, merged);
  saveStorageError = null;
  await saveState();
  toast(decoded.legacy ? "旧版存档已导入并加密" : "加密存档已导入");
  renderAll();
}

async function resetDemo() {
  if (!await showConfirmDialog("确定重置所有数据吗？当前职业数据会被覆盖，操作前将自动保留备份。")) return;
  writeBackup("重置所有数据前");
  Object.assign(state, defaultState());
  saveStorageError = null;
  await saveState();
  toast("已重置所有数据");
  renderAll();
  loginPilot();
}

function handleAction(event) {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const { action: name, id } = action.dataset;
  if (name === "accept-mission") acceptMission(id);
  if (name === "manual-complete-mission") void manualCompleteMission(id);
  if (name === "delete-mission") void deleteMission(id);
  if (name === "restore-backup") {
    if (els.settingsModal?.open) els.settingsModal.close();
    void restoreBackup(id);
  }
  if (name === "buy-aircraft") buyAircraft(id);
  if (name === "rent-aircraft") rentAircraft(id);
  if (name === "return-aircraft") returnAircraft(id);
  if (name === "sell-aircraft") void sellAircraft(id);
  if (name === "select-aircraft") { selectAircraft(id); renderAll(); toast("已切换默认机型"); }
  if (name === "refuel-aircraft") void refuelAircraft(id);
  if (name === "repair-aircraft") repairAircraft(id);
  if (name === "buy-aircraft-license") purchaseAircraftLicense(id);
  if (name === "create-company") createCompany();
  if (name === "close-company") void closeCompany();
  if (name === "hire-company-pilot") hireCompanyPilot(id);
  if (name === "upgrade-company-pilot") upgradeCompanyPilot(id);
  if (name === "fire-company-pilot") fireCompanyPilot(id);
  if (name === "dispatch-company-task") dispatchCompanyTask(id);
  if (name === "complete-company-task") completeCompanyTask(id);
  if (name === "open-company-tasks") setCompanySection("tasks");
}

function bindEvents() {
  els.viewButtons.forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
  document.querySelectorAll("[data-view-shortcut]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.viewShortcut));
  });
  document.querySelectorAll("[data-company-section]").forEach((button) => {
    button.addEventListener("click", () => setCompanySection(button.dataset.companySection));
  });

  document.addEventListener("click", handleAction);
  document.addEventListener("input", handleAircraftManagementInput);
  els.companyTaskList?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-company-pilot-for], [data-company-aircraft-for]");
    if (!select) return;
    const row = select.closest("[data-company-dispatch-for]");
    updateCompanyTaskSelectors(row, select.matches("[data-company-pilot-for]") ? "pilot" : "aircraft");
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "pilotNameInput") {
      event.target.value = String(event.target.value || "").replace(/\D/g, "").slice(0, 32);
    }
    if (event.target.id === "pilotBaseInput" || event.target.id === "companyBaseInput") {
      event.target.value = normalizeAirportInputCode(event.target.value);
    }
    if (event.target.id === "planOriginInput" || event.target.id === "planDestinationInput") {
      updatePlanAirportFields();
    }
    if (event.target.id === "companyBaseInput" || event.target.id === "companyNameInput") updateCompanyCreatePreview();
  });
  els.followAircraftBtn.addEventListener("click", toggleMapTracking);
  els.toggleCompanyAircraftBtn.addEventListener("click", toggleCompanyAircraft);
  els.mapLayerControls.forEach((button) => {
    button.addEventListener("click", () => setMapLayer(button.dataset.mapLayer));
  });
  document.getElementById("refreshMapBtn").addEventListener("click", renderMapPage);
  document.getElementById("connectSimulatorBtn").addEventListener("click", connectSimulator);
  document.getElementById("createBackupBtn").addEventListener("click", createManualBackup);
  els.generatePlannedMissionBtn.addEventListener("click", generatePlannedMission);
  els.planAircraftSelect?.addEventListener("change", updatePlanAirportFields);
  document.getElementById("heroMissionBtn").addEventListener("click", () => showView("missions"));
  document.getElementById("heroLogBtn").addEventListener("click", () => showView("logs"));
  els.loginPilotBtn.addEventListener("click", togglePilotLogin);
  els.avatarChoiceGrid?.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-avatar-choice]");
    if (choice) selectAvatar(choice.dataset.avatarChoice);
  });
  els.uploadAvatarBtn?.addEventListener("click", () => els.pilotAvatarFile?.click());
  els.pilotAvatarFile?.addEventListener("change", async () => {
    const file = els.pilotAvatarFile.files?.[0];
    if (!file) return;
    try {
      state.pilot.avatarDataUrl = await resizeAvatarFile(file);
      state.pilot.avatarPreset = "";
      renderAvatar(els.pilotAvatarPreview, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
      renderAvatar(els.pilotInitials, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
      renderAvatarChoices();
      saveState();
      wireIcons();
      toast("头像已更新");
    } catch (error) {
      toast(error?.message === "avatar-too-large" ? "头像文件不能超过 5 MB" : "头像格式不支持，请选择 PNG、JPG 或 WebP 图片");
    } finally {
      els.pilotAvatarFile.value = "";
    }
  });
  els.supportBtn?.addEventListener("click", openSupport);
  els.thankSupportBtn?.addEventListener("click", openSupport);
  els.themeModeBtn?.addEventListener("click", toggleThemeMode);
  els.contactAuthorBtn?.addEventListener("click", openContactAuthor);
  els.copyAuthorQqBtn?.addEventListener("click", () => void copyAuthorQqGroup());
  els.aboutBtn?.addEventListener("click", openAbout);
  document.getElementById("exportBtn").addEventListener("click", () => void exportSave().catch(() => toast("存档加密失败，请稍后重试")));
  document.getElementById("importBtn").addEventListener("click", () => els.importFile.click());
  els.settingsBtn.addEventListener("click", openSettings);
  els.speechVolumeRange.addEventListener("input", updateSettingsVolumePreview);
  els.settingsModal.addEventListener("close", closeSettings);
  els.refreshRuntimeLogBtn?.addEventListener("click", () => void loadRuntimeLogs());
  els.clearRuntimeLogBtn?.addEventListener("click", () => void clearRuntimeLogs());
  els.exportRuntimeLogBtn?.addEventListener("click", () => void exportRuntimeLogs());
  document.getElementById("resetBtn").addEventListener("click", () => void resetDemo());
  document.getElementById("refreshApplicantsBtn").addEventListener("click", refreshCompanyApplicants);
  document.getElementById("refreshCompanyTasksBtn").addEventListener("click", refreshCompanyTasks);

  els.missionSearch.addEventListener("input", () => {
    state.missionFilters.search = els.missionSearch.value;
    saveState();
    renderMissions();
    wireIcons();
  });
  els.missionDistanceSort.addEventListener("change", () => {
    state.missionFilters.distanceSort = els.missionDistanceSort.value;
    saveState();
    renderMissions();
    wireIcons();
  });
  els.missionStatusFilter.addEventListener("change", () => {
    state.missionFilters.status = els.missionStatusFilter.value;
    saveState();
    renderMissions();
    wireIcons();
  });
  els.missionCategoryButtons.forEach((button) => button.addEventListener("click", () => {
    state.missionFilters.category = button.dataset.missionCategory || "all";
    saveState();
    renderMissions();
    wireIcons();
  }));
  els.refreshMissionsBtn?.addEventListener("click", () => {
    autoRefreshMissions({ silent: false, forceRefresh: true });
  });
  els.refreshLicenseAssessmentsBtn?.addEventListener("click", refreshLicenseAssessmentMissions);

  els.importFile.addEventListener("change", async () => {
    const file = els.importFile.files?.[0];
    if (!file) return;
    try {
      await importSave(file);
    } catch (error) {
      toast("导入失败，文件格式不正确");
    } finally {
      els.importFile.value = "";
    }
  });

  els.pilotForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (await savePilot()) toast(`已登录：${state.pilot.name}`);
  });

  els.hangarFilter.addEventListener("change", () => {
    state.hangarFilter = els.hangarFilter.value;
    saveState();
    renderHangar();
  });

  els.hangarSearch.addEventListener("input", () => {
    state.hangarSearch = els.hangarSearch.value;
    saveState();
    renderHangar();
  });
  els.aircraftManagementFilter?.addEventListener("change", () => {
    state.aircraftManagementFilter = els.aircraftManagementFilter.value;
    saveState();
    renderAircraftManagement();
  });
  els.aircraftManagementSearch?.addEventListener("input", () => {
    state.aircraftManagementSearch = els.aircraftManagementSearch.value;
    saveState();
    renderAircraftManagement();
  });
  els.companyHangarFilter?.addEventListener("change", () => {
    state.companyHangarFilter = els.companyHangarFilter.value;
    saveState();
    renderCompanyHangar();
    wireIcons();
  });
  els.companyHangarSearch?.addEventListener("input", () => {
    state.companyHangarSearch = els.companyHangarSearch.value;
    saveState();
    renderCompanyHangar();
    wireIcons();
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void exportSave().catch(() => toast("存档加密失败，请稍后重试"));
    }
  });
}

function migrateMissionRouteTitle(mission) {
  if (mission?.site && typeof mission.title === "string") {
    mission.title = mission.title.replace(/→\s*现场\s*(\d{3}°)/, "→ 航向 $1");
  }
  return mission;
}

function hydrateFromState() {
  const taskEventsBeforeDedupe = Array.isArray(state.taskEvents) ? state.taskEvents.length : 0;
  const starterHelicopterGranted = grantStarterHelicopter(state);
  let companyStarterAircraftGranted = false;
  if (state.company?.created && state.company.starterAircraftGranted !== true) {
    const existingCompanyAircraft = state.fleet.find((aircraft) => isCompanyAircraft(aircraft));
    const companyAircraft = existingCompanyAircraft || createCompanyAircraft();
    if (companyAircraft && !existingCompanyAircraft) state.fleet.push(companyAircraft);
    if (companyAircraft) {
      state.company.aircraftIds = [...new Set([...(state.company.aircraftIds || []), companyAircraft.id])];
      state.company.starterAircraftGranted = true;
      companyStarterAircraftGranted = true;
    }
  }
  const landingWearStarted = !(Number(state.features?.landingWearStartedAt) > 0);
  if (landingWearStarted) {
    state.features = { ...(state.features || {}), landingWearStartedAt: Date.now() };
  }
  state.taskEvents = uniqueTaskEvents(state.taskEvents);
  state.missions = Array.isArray(state.missions) ? state.missions.filter(Boolean) : [];
  const removedOpenMissions = removeOpenMissionsOutsideBase();
  if (!state.fleet.some((item) => item.selected && !isCompanyAircraft(item))) selectAircraft("c172");
  if (!state.missions.length) state.missions = seedMissions();
  state.missions.forEach((mission) => {
    let resetLegacySceneArrival = false;
    migrateMissionRouteTitle(mission);
    // Older saves stored an airline on each mission. Keep the save compatible,
    // but remove the obsolete relationship so the airline panel stays independent.
    delete mission.airlineId;
    if (mission.refreshable === undefined) mission.refreshable = !String(mission.subtype || "").startsWith("时刻表");
    mission.priority ||= isEmergencyMission(mission) ? "emergency" : mission.refreshable === false ? "scheduled" : "standard";
    mission.aircraftHint ||= currentAircraft().name;
    mission.permittedAircraftIds ||= [currentAircraft().id];
    mission.dispatchPhase ||= "日间";
    mission.recommendedPhases ||= missionPolicies[mission.category]?.phases || ["日间"];
    if (mission.scene?.objectTitle) {
      const previousArrivalMode = mission.scene.arrivalMode;
      mission.scene.icon = flightCareerMissionScenes[mission.subtype]?.icon || mission.scene.icon;
      mission.scene.objectTitle = mission.scene.objectTitle.replace(/^neofly/i, "FCM");
      if (typeof mission.scene.clip === "string") mission.scene.clip = mission.scene.clip.replace(/neofly/gi, "FCM");
      mission.scene.terrain = missionTerrainType(mission);
      mission.scene.requiresLanding = missionRequiresLanding(mission);
      mission.scene.arrivalMode = mission.scene.requiresLanding ? "landing" : "low-altitude";
      resetLegacySceneArrival = previousArrivalMode === "low-altitude" && mission.scene.arrivalMode === "landing";
      mission.scene.source = "Flight Career Objects 1.0.0";
    }
    if (typeof mission.verification?.sceneDetail === "string") {
      mission.verification.sceneDetail = mission.verification.sceneDetail.replace(/NeoFly 对象包/gi, "Flight Career Objects");
    }
    if (mission.status === "accepted" && mission.verification) {
      mission.verification.aircraftId ||= mission.permittedAircraftIds[0] || currentAircraft().id;
      mission.verification.aircraftName ||= state.fleet.find((aircraft) => aircraft.id === mission.verification.aircraftId)?.name || mission.aircraftHint;
      if (mission.verification.phase === "airborne") mission.verification.phase = "outbound";
      if (!mission.verification.phase) mission.verification.phase = "briefed";
      mission.verification.lastTelemetryTimestamp ||= "";
      const legacyPositionLock = mission.verification.teleportLocked === true
        && mission.verification.teleportReason !== "slew";
      mission.verification.teleportLocked = legacyPositionLock ? false : mission.verification.teleportLocked === true;
      mission.verification.teleportReason = mission.verification.teleportLocked ? "slew" : "";
      mission.verification.teleportDistanceNm ||= 0;
      mission.verification.teleportElapsedSec ||= 0;
      mission.verification.ignoredTelemetryJumps = Math.max(0, Number(mission.verification.ignoredTelemetryJumps) || 0);
      if (legacyPositionLock) {
        mission.verification.teleportDistanceNm = 0;
        mission.verification.teleportElapsedSec = 0;
        mission.verification.lastPoint = null;
        mission.verification.lastTelemetryTimestamp = "";
      }
      mission.verification.lastVoiceKey ||= "";
      if (mission.verification.engineRunning === undefined) mission.verification.engineRunning = null;
      mission.verification.engineStartAnnounced ||= false;
      mission.verification.outboundStartPoint ||= null;
      mission.verification.departureAirport ||= null;
      mission.verification.arrivalAirport ||= null;
      mission.verification.landingDwellStartedAt ||= null;
      mission.verification.landingDwellSeconds ||= 0;
      mission.verification.targetLandingConfirmed ||= false;
      if (resetLegacySceneArrival
        && ["target-confirmed", "returning"].includes(mission.verification.phase)
        && !mission.verification.targetLandingConfirmed) {
        mission.verification.phase = "outbound";
        mission.verification.phaseLabel = "前往任务点";
        mission.verification.detail = "该任务使用地面救援模型，必须在任务现场安全着陆并确认接地后才能返航。";
        mission.verification.landingDwellStartedAt = null;
        mission.verification.landingDwellSeconds = 0;
        mission.verification.arrivalNoticeAnnounced = false;
      }
      mission.verification.arrivalNoticeAnnounced ||= false;
      if (mission.verification.rewardEligible === undefined) mission.verification.rewardEligible = null;
      if (mission.verification.fuelStartKg === undefined) mission.verification.fuelStartKg = null;
      if (mission.verification.fuelCurrentKg === undefined) mission.verification.fuelCurrentKg = null;
      if (mission.verification.fuelLastKg === undefined) mission.verification.fuelLastKg = null;
      mission.verification.fuelUsedKg = Math.max(0, Number(mission.verification.fuelUsedKg) || 0);
      mission.verification.fuelAddedKg = Math.max(0, Number(mission.verification.fuelAddedKg) || 0);
      mission.verification.fuelUpdatedAt ||= null;
      ensureSopState(mission.verification);
      if (isSopMode()) mission.verification.sop.enabled = true;
    }
  });
  const licenseAssessmentsAdded = ensureLicenseAssessmentMissions();
  if (!state.logs.length && state.stats.totalHours > 0) {
    state.logs.unshift({
      id: cryptoId("log"),
      date: Date.now() - 86400000,
      from: state.pilot.base,
      to: "ZSPD",
      aircraftId: currentAircraft().id,
      aircraftName: currentAircraft().name,
      hours: 1.4,
      miles: 210,
      income: 2400,
      notes: "演示日志"
    });
  }
  if (!state.achievements.length) {
    state.achievements = achievementDefs.map((a) => ({ id: a.id, unlocked: false }));
  }
  if (!state.features?.sceneObjectsSeeded && !state.features?.neoFlyScenesSeeded) {
    [
      ["搜救", "坠机现场搜救"],
      ["海上救援", "海上人员搜救"],
      ["事故调查", "航空事故调查"]
    ].reverse().forEach(([category, subtype], index) => {
      const mission = makeSceneMission(category, subtype, index + 1);
      if (mission) state.missions.unshift(mission);
    });
    state.features = { ...(state.features || {}), sceneObjectsSeeded: true };
  }
  if (state.features?.neoFlyScenesSeeded) {
    state.features.sceneObjectsSeeded = true;
    delete state.features.neoFlyScenesSeeded;
  }
  if (taskEventsBeforeDedupe !== state.taskEvents.length || removedOpenMissions > 0 || starterHelicopterGranted || companyStarterAircraftGranted || landingWearStarted || licenseAssessmentsAdded) saveState();
}

async function initializeTerrainData() {
  try {
    const response = await fetch("./assets/data/land-110m.geojson", { cache: "force-cache" });
    if (!response.ok) throw new Error(`terrain ${response.status}`);
    const geojson = await response.json();
    const polygonCount = window.FlightTerrain?.configure(geojson) || 0;
    if (!polygonCount) throw new Error("terrain data is empty");
    return true;
  } catch {
    // Standard airport missions remain available if the optional terrain file is unavailable.
    return false;
  }
}

async function initializeGlobalAirportData() {
  try {
    const response = await fetch("./assets/data/global-airports-zh.json", { cache: "force-cache" });
    if (!response.ok) throw new Error(`airports ${response.status}`);
    const payload = await response.json();
    const airports = Array.isArray(payload?.airports) ? payload.airports.filter((airport) => /^[A-Z0-9]{4}$/.test(airport?.icao)) : [];
    if (!airports.length) throw new Error("airport data is empty");
    globalAirportDatabase = airports;
    globalAirportIndex = new Map(airports.map((airport) => [airport.icao, airport]));
    return true;
  } catch {
    globalAirportDatabase = [...airportDatabase];
    globalAirportIndex = new Map(globalAirportDatabase.map((airport) => [airport.icao, airport]));
    return false;
  }
}

async function startApplication() {
  await Promise.all([initializeTerrainData(), initializeGlobalAirportData()]);
  await Promise.all([hydrateStoredState(), hydrateBackups()]);
  hydrateFromState();
  bindEvents();
  const hasPilotProfile = Boolean(state.pilot?.hasCompletedLogin && state.pilot?.name?.trim() && state.pilot?.base?.trim());
  state.pilot.loggedIn = hasPilotProfile;
  applyTheme(state.settings?.darkMode === true);
  renderAll();
  if (saveStorageError) {
    window.setTimeout(() => toast("存档校验失败，已拒绝加载被修改的数据；如需重新开始，请使用重置所有数据"), 0);
  }
  if (hasPilotProfile) enterSystem();
  else loginPilot();
  document.body.dataset.appReady = "true";
  void pollSimulator();
  simulatorPollTimer = window.setInterval(pollSimulator, 2000);
  autoRefreshMissions({ rotateExpired: true });
  missionRefreshTimer = window.setInterval(() => autoRefreshMissions({ rotateExpired: true }), MISSION_REFRESH_INTERVAL_MS);
}

window.addEventListener("error", (event) => {
  void reportRuntimeLog("error", "前端运行异常", { message: event.message, source: event.filename, line: event.lineno });
});
window.addEventListener("unhandledrejection", (event) => {
  void reportRuntimeLog("error", "未处理的异步异常", { reason: String(event.reason?.message || event.reason || "unknown") });
});

startApplication();
