use chacha20poly1305::{aead::{Aead, Payload}, KeyInit, XChaCha20Poly1305, XNonce};
use curve25519_dalek::{
    constants::RISTRETTO_BASEPOINT_POINT,
    ristretto::{CompressedRistretto, RistrettoPoint},
    scalar::Scalar,
};
use sha2::{Digest, Sha256};
use std::{convert::TryInto, env, fs, time::Instant};

const MAGIC: &[u8; 8] = b"LABXRLG1";
const KEY_DOMAIN: &[u8] = b"LABX/ALICE/RELATION-LEDGER/2026\x00";

struct Reader<'a> { data: &'a [u8], offset: usize }
impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self { Self { data, offset: 0 } }
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.offset.checked_add(n).ok_or("размер файла переполнен")?;
        if end > self.data.len() { return Err("файл обрезан".into()); }
        let result = &self.data[self.offset..end]; self.offset = end; Ok(result)
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn scalar(&mut self) -> Result<Scalar, String> {
        let bytes: [u8; 32] = self.take(32)?.try_into().unwrap();
        Option::<Scalar>::from(Scalar::from_canonical_bytes(bytes))
            .ok_or_else(|| "неканонический скаляр".into())
    }
    fn point(&mut self) -> Result<RistrettoPoint, String> {
        let bytes: [u8; 32] = self.take(32)?.try_into().unwrap();
        CompressedRistretto(bytes).decompress().ok_or_else(|| "некорректная точка".into())
    }
}

fn mix(mut z: u64) -> u64 {
    z ^= z >> 30; z = z.wrapping_mul(0xbf58476d1ce4e5b9);
    z ^= z >> 27; z = z.wrapping_mul(0x94d049bb133111eb);
    z ^ (z >> 31)
}
fn point_key(point: &RistrettoPoint) -> u64 {
    let bytes = point.compress().to_bytes();
    u64::from_le_bytes(bytes[..8].try_into().unwrap())
}

fn run() -> Result<(), String> {
    let mut arguments = env::args().skip(1);
    let path = arguments.next().unwrap_or_else(|| "../public/sample.bin".into());
    let answer_only = arguments.next().as_deref() == Some("--answer-only");
    let file = fs::read(path).map_err(|e| e.to_string())?;
    let mut rd = Reader::new(&file);
    if rd.take(8)? != MAGIC { return Err("неверная сигнатура".into()); }
    if rd.u32()? != 1 { return Err("неподдерживаемая версия".into()); }
    let size = rd.u32()? as usize;
    if size < 2 || size > 8192 { return Err("некорректный размер таблицы".into()); }
    let count = 4 * size;
    let q = rd.point()?;
    let mut points = Vec::with_capacity(count);
    for _ in 0..count { points.push(rd.point()?); }

    let mut parents = vec![0usize; count];
    let mut edge_u = vec![Scalar::ZERO; count];
    let mut edge_v = vec![Scalar::ZERO; count];
    let mut seen = vec![false; count];
    for _ in 1..count {
        let child = rd.u32()? as usize;
        let parent = rd.u32()? as usize;
        let u = rd.scalar()?;
        let v = rd.scalar()?;
        if child == 0 || child >= count || parent >= child || seen[child] {
            return Err("некорректное дерево".into());
        }
        seen[child] = true; parents[child] = parent; edge_u[child] = u; edge_v[child] = v;
    }
    if seen[1..].iter().any(|found| !found) { return Err("ребро отсутствует".into()); }
    let target_u = rd.scalar()?;
    let target_v = rd.scalar()?;
    let target = rd.point()?;
    let nonce: [u8; 24] = rd.take(24)?.try_into().unwrap();
    let sealed_len = rd.u32()? as usize;
    let sealed = rd.take(sealed_len)?;
    if rd.offset != file.len() { return Err("лишние байты после записи".into()); }
    if RISTRETTO_BASEPOINT_POINT * target_u + q * target_v != target {
        return Err("неверная целевая точка".into());
    }

    let shift = size.next_power_of_two().trailing_zeros();
    let pair_count = size * size;
    let capacity = (pair_count + pair_count / 3).next_power_of_two();
    let mask = capacity - 1;
    eprintln!("таблицы: {size} точек; пары: {pair_count}; хеш-таблица: {} МиБ",
              (capacity * 12) / (1024 * 1024));
    let started = Instant::now();
    let mut keys = vec![0u64; capacity];
    let mut values = vec![0u32; capacity];
    for i in 0..size {
        for j in 0..size {
            let key = point_key(&(&points[i] + &points[size + j]));
            let mut slot = (mix(key) as usize) & mask;
            while values[slot] != 0 { slot = (slot + 1) & mask; }
            keys[slot] = key;
            values[slot] = 1 + (((i as u32) << shift) | j as u32);
        }
    }
    eprintln!("пары построены за {:.1} с", started.elapsed().as_secs_f64());

    let mut found = None;
    'outer: for k in 0..size {
        let with_k = &target + &points[2 * size + k];
        for l in 0..size {
            let wanted = &with_k + &points[3 * size + l];
            let key = point_key(&wanted);
            let mut slot = (mix(key) as usize) & mask;
            while values[slot] != 0 {
                if keys[slot] == key {
                    let packed = values[slot] - 1;
                    let i = (packed >> shift) as usize;
                    let j = (packed & ((1 << shift) - 1)) as usize;
                    if &points[i] + &points[size + j] == wanted {
                        found = Some([i, size + j, 2 * size + k, 3 * size + l]);
                        break 'outer;
                    }
                }
                slot = (slot + 1) & mask;
            }
        }
    }
    let indices = found.ok_or("четвёрка точек не найдена")?;
    eprintln!("четвёрка найдена за {:.1} с: {:?}", started.elapsed().as_secs_f64(), indices);

    // Every tree edge gives log(A_child) - log(A_parent) = u + v*d.
    // With an arbitrary root log, each point has log(A_i) = root + a_i + b_i*d.
    let mut a = vec![Scalar::ZERO; count];
    let mut b = vec![Scalar::ZERO; count];
    for child in 1..count {
        let parent = parents[child];
        a[child] = a[parent] + edge_u[child];
        b[child] = b[parent] + edge_v[child];
    }
    let aa = a[indices[0]] + a[indices[1]] - a[indices[2]] - a[indices[3]];
    let bb = b[indices[0]] + b[indices[1]] - b[indices[2]] - b[indices[3]];
    let divisor = target_v - bb;
    if divisor == Scalar::ZERO { return Err("вырожденная зависимость".into()); }
    let secret = (aa - target_u) * divisor.invert();
    if RISTRETTO_BASEPOINT_POINT * secret != q { return Err("скаляр не совпал с Q".into()); }

    if answer_only {
        for byte in secret.to_bytes() { print!("{byte:02x}"); }
        println!();
        eprintln!("полное решение: {:.1} с", started.elapsed().as_secs_f64());
        return Ok(());
    }
    if sealed.is_empty() { return Err("сетевая запись требует --answer-only".into()); }

    let mut digest = Sha256::new();
    digest.update(KEY_DOMAIN);
    digest.update(secret.to_bytes());
    let key = digest.finalize();
    let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|e| e.to_string())?;
    let message = cipher.decrypt(XNonce::from_slice(&nonce), Payload { msg: sealed, aad: MAGIC })
        .map_err(|_| "тег шифртекста не совпал")?;
    println!("{}", String::from_utf8(message).map_err(|e| e.to_string())?);
    eprintln!("полное решение: {:.1} с", started.elapsed().as_secs_f64());
    Ok(())
}

fn main() {
    if let Err(error) = run() { eprintln!("Ошибка: {error}"); std::process::exit(1); }
}
