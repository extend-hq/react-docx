//! Read-only parser for OLE2 / Compound File Binary (CFB) containers ([MS-CFB]).
//! Legacy .doc files store their streams (`WordDocument`, `0Table`/`1Table`, `Data`)
//! inside this container format.

use std::collections::HashMap;

pub const CFB_SIGNATURE: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

const SECT_END_OF_CHAIN: u32 = 0xFFFF_FFFE;
const SECT_FREE: u32 = 0xFFFF_FFFF;
const DIR_ENTRY_SIZE: usize = 128;
const OBJECT_TYPE_STREAM: u8 = 2;
const OBJECT_TYPE_ROOT: u8 = 5;
const MAX_CHAIN_SECTORS: usize = 1 << 22;

pub struct CompoundFile {
    streams: HashMap<String, Vec<u8>>,
}

struct DirEntry {
    name: String,
    object_type: u8,
    left: u32,
    right: u32,
    child: u32,
    start_sector: u32,
    size: u64,
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    bytes
        .get(offset..offset + 2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .ok_or_else(|| "CFB: unexpected end of data reading u16".to_string())
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    bytes
        .get(offset..offset + 4)
        .map(|chunk| u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .ok_or_else(|| "CFB: unexpected end of data reading u32".to_string())
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, String> {
    bytes
        .get(offset..offset + 8)
        .map(|chunk| {
            u64::from_le_bytes([
                chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6], chunk[7],
            ])
        })
        .ok_or_else(|| "CFB: unexpected end of data reading u64".to_string())
}

pub fn is_cfb(bytes: &[u8]) -> bool {
    bytes.len() >= 8 && bytes[..8] == CFB_SIGNATURE
}

impl CompoundFile {
    pub fn parse(bytes: &[u8]) -> Result<CompoundFile, String> {
        if !is_cfb(bytes) {
            return Err("CFB: missing compound file signature".to_string());
        }
        if bytes.len() < 512 {
            return Err("CFB: file too small for header".to_string());
        }

        let major_version = read_u16(bytes, 26)?;
        let sector_shift = read_u16(bytes, 30)? as u32;
        let expected_shift = if major_version == 4 { 12 } else { 9 };
        if sector_shift != expected_shift {
            return Err(format!(
                "CFB: unexpected sector shift {sector_shift} for version {major_version}"
            ));
        }
        let sector_size = 1usize << sector_shift;

        let dir_start = read_u32(bytes, 48)?;
        let mini_cutoff = read_u32(bytes, 56)? as u64;
        let mini_fat_start = read_u32(bytes, 60)?;
        let difat_start = read_u32(bytes, 68)?;

        let fat = build_fat(bytes, sector_size, difat_start)?;

        let directory = read_chain(bytes, sector_size, &fat, dir_start)?;
        let entries = parse_directory(&directory)?;
        if entries.is_empty() {
            return Err("CFB: empty directory".to_string());
        }

        let root = entries
            .iter()
            .find(|entry| entry.object_type == OBJECT_TYPE_ROOT)
            .ok_or_else(|| "CFB: missing root directory entry".to_string())?;

        let mini_stream = read_chain(bytes, sector_size, &fat, root.start_sector)?;
        let mini_fat = read_sector_table(bytes, sector_size, &fat, mini_fat_start)?;

        let mut streams = HashMap::new();
        let mut visited = vec![false; entries.len()];
        let mut stack = vec![entries[0].child];
        while let Some(index) = stack.pop() {
            let index = index as usize;
            if index >= entries.len() || visited[index] {
                continue;
            }
            visited[index] = true;
            let entry = &entries[index];
            stack.push(entry.left);
            stack.push(entry.right);
            stack.push(entry.child);

            if entry.object_type != OBJECT_TYPE_STREAM {
                continue;
            }

            let data = if entry.size < mini_cutoff {
                read_mini_chain(&mini_stream, &mini_fat, entry.start_sector, entry.size)?
            } else {
                let mut data = read_chain(bytes, sector_size, &fat, entry.start_sector)?;
                if (entry.size as usize) <= data.len() {
                    data.truncate(entry.size as usize);
                }
                data
            };
            streams.entry(entry.name.clone()).or_insert(data);
        }

        Ok(CompoundFile { streams })
    }

    pub fn stream(&self, name: &str) -> Option<&[u8]> {
        self.streams.get(name).map(|data| data.as_slice())
    }
}

fn build_fat(bytes: &[u8], sector_size: usize, difat_start: u32) -> Result<Vec<u32>, String> {
    let entries_per_sector = sector_size / 4;
    let mut fat_sectors = Vec::new();

    for index in 0..109 {
        let sector = read_u32(bytes, 76 + index * 4)?;
        if sector != SECT_FREE && sector != SECT_END_OF_CHAIN {
            fat_sectors.push(sector);
        }
    }

    let mut difat_sector = difat_start;
    let mut difat_guard = 0usize;
    while difat_sector != SECT_END_OF_CHAIN && difat_sector != SECT_FREE {
        difat_guard += 1;
        if difat_guard > MAX_CHAIN_SECTORS {
            return Err("CFB: DIFAT chain too long".to_string());
        }
        let offset = sector_offset(difat_sector, sector_size);
        for index in 0..entries_per_sector - 1 {
            let sector = read_u32(bytes, offset + index * 4)?;
            if sector != SECT_FREE && sector != SECT_END_OF_CHAIN {
                fat_sectors.push(sector);
            }
        }
        difat_sector = read_u32(bytes, offset + (entries_per_sector - 1) * 4)?;
    }

    let mut fat = Vec::with_capacity(fat_sectors.len() * entries_per_sector);
    for sector in fat_sectors {
        let offset = sector_offset(sector, sector_size);
        for index in 0..entries_per_sector {
            fat.push(read_u32(bytes, offset + index * 4)?);
        }
    }
    Ok(fat)
}

fn sector_offset(sector: u32, sector_size: usize) -> usize {
    (sector as usize + 1) * sector_size
}

fn read_chain(
    bytes: &[u8],
    sector_size: usize,
    fat: &[u32],
    start_sector: u32,
) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    let mut sector = start_sector;
    let mut guard = 0usize;
    while sector != SECT_END_OF_CHAIN && sector != SECT_FREE {
        guard += 1;
        if guard > MAX_CHAIN_SECTORS {
            return Err("CFB: sector chain too long (cycle?)".to_string());
        }
        let offset = sector_offset(sector, sector_size);
        let end = offset + sector_size;
        if end > bytes.len() {
            return Err("CFB: sector chain points past end of file".to_string());
        }
        data.extend_from_slice(&bytes[offset..end]);
        sector = *fat
            .get(sector as usize)
            .ok_or_else(|| "CFB: sector index outside FAT".to_string())?;
    }
    Ok(data)
}

fn read_sector_table(
    bytes: &[u8],
    sector_size: usize,
    fat: &[u32],
    start_sector: u32,
) -> Result<Vec<u32>, String> {
    if start_sector == SECT_END_OF_CHAIN || start_sector == SECT_FREE {
        return Ok(Vec::new());
    }
    let raw = read_chain(bytes, sector_size, fat, start_sector)?;
    Ok(raw
        .chunks_exact(4)
        .map(|chunk| u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn read_mini_chain(
    mini_stream: &[u8],
    mini_fat: &[u32],
    start_sector: u32,
    size: u64,
) -> Result<Vec<u8>, String> {
    const MINI_SECTOR_SIZE: usize = 64;
    let mut data = Vec::with_capacity(size as usize);
    let mut sector = start_sector;
    let mut guard = 0usize;
    while sector != SECT_END_OF_CHAIN && sector != SECT_FREE {
        guard += 1;
        if guard > MAX_CHAIN_SECTORS {
            return Err("CFB: mini sector chain too long (cycle?)".to_string());
        }
        let offset = sector as usize * MINI_SECTOR_SIZE;
        let end = offset + MINI_SECTOR_SIZE;
        if end > mini_stream.len() {
            return Err("CFB: mini sector outside mini stream".to_string());
        }
        data.extend_from_slice(&mini_stream[offset..end]);
        sector = *mini_fat
            .get(sector as usize)
            .ok_or_else(|| "CFB: mini sector index outside mini FAT".to_string())?;
    }
    data.truncate(size as usize);
    Ok(data)
}

fn parse_directory(directory: &[u8]) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    for chunk in directory.chunks_exact(DIR_ENTRY_SIZE) {
        let name_length = read_u16(chunk, 64)? as usize;
        let object_type = chunk[66];
        let name = if (2..=64).contains(&name_length) {
            let units: Vec<u16> = chunk[..name_length - 2]
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            String::from_utf16_lossy(&units)
        } else {
            String::new()
        };
        entries.push(DirEntry {
            name,
            object_type,
            left: read_u32(chunk, 68)?,
            right: read_u32(chunk, 72)?,
            child: read_u32(chunk, 76)?,
            start_sector: read_u32(chunk, 116)?,
            size: read_u64(chunk, 120)? & 0xFFFF_FFFF,
        });
    }
    Ok(entries)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Builds a minimal valid CFB v3 container holding the given streams,
    /// exercising both the regular FAT (>= 4096 bytes) and the mini stream path.
    pub(crate) fn build_cfb(streams: &[(&str, &[u8])]) -> Vec<u8> {
        const SECTOR: usize = 512;
        let mut sectors: Vec<[u8; SECTOR]> = Vec::new();
        let mut fat: Vec<u32> = Vec::new();

        fn append_data(
            sectors: &mut Vec<[u8; SECTOR]>,
            fat: &mut Vec<u32>,
            data: &[u8],
        ) -> u32 {
            let start = sectors.len() as u32;
            let count = data.len().div_ceil(SECTOR).max(1);
            for index in 0..count {
                let mut sector = [0u8; SECTOR];
                let begin = index * SECTOR;
                let end = (begin + SECTOR).min(data.len());
                if begin < data.len() {
                    sector[..end - begin].copy_from_slice(&data[begin..end]);
                }
                sectors.push(sector);
                fat.push(if index + 1 == count {
                    SECT_END_OF_CHAIN
                } else {
                    (start as usize + index + 1) as u32
                });
            }
            start
        }

        // Mini stream: streams smaller than 4096 bytes.
        let mut mini_stream: Vec<u8> = Vec::new();
        let mut mini_fat: Vec<u32> = Vec::new();
        let mut placements: Vec<(usize, u32, u64)> = Vec::new(); // (stream index, start sector, size)

        for (index, (_, data)) in streams.iter().enumerate() {
            if data.len() < 4096 {
                let start = (mini_stream.len() / 64) as u32;
                let count = data.len().div_ceil(64).max(1);
                mini_stream.extend_from_slice(data);
                let padded = count * 64;
                mini_stream.resize(mini_stream.len() + padded - data.len(), 0);
                for sector_index in 0..count {
                    mini_fat.push(if sector_index + 1 == count {
                        SECT_END_OF_CHAIN
                    } else {
                        start + sector_index as u32 + 1
                    });
                }
                placements.push((index, start, data.len() as u64));
            }
        }

        let mini_stream_start = append_data(&mut sectors, &mut fat, &mini_stream);
        let mini_fat_bytes: Vec<u8> = mini_fat.iter().flat_map(|value| value.to_le_bytes()).collect();
        let mini_fat_start = append_data(&mut sectors, &mut fat, &mini_fat_bytes);

        for (index, (_, data)) in streams.iter().enumerate() {
            if data.len() >= 4096 {
                let start = append_data(&mut sectors, &mut fat, data);
                placements.push((index, start, data.len() as u64));
            }
        }

        // Directory: root + one entry per stream, linked as a simple chain via `right`.
        let mut directory = Vec::new();
        let entry_count = streams.len() + 1;
        let write_entry = |directory: &mut Vec<u8>,
                           name: &str,
                           object_type: u8,
                           right: u32,
                           child: u32,
                           start: u32,
                           size: u64| {
            let mut entry = [0u8; DIR_ENTRY_SIZE];
            let units: Vec<u16> = name.encode_utf16().collect();
            for (index, unit) in units.iter().enumerate() {
                entry[index * 2..index * 2 + 2].copy_from_slice(&unit.to_le_bytes());
            }
            entry[64..66].copy_from_slice(&(((units.len() + 1) * 2) as u16).to_le_bytes());
            entry[66] = object_type;
            entry[68..72].copy_from_slice(&SECT_FREE.to_le_bytes());
            entry[72..76].copy_from_slice(&right.to_le_bytes());
            entry[76..80].copy_from_slice(&child.to_le_bytes());
            entry[116..120].copy_from_slice(&start.to_le_bytes());
            entry[120..128].copy_from_slice(&size.to_le_bytes());
            directory.extend_from_slice(&entry);
        };

        write_entry(
            &mut directory,
            "Root Entry",
            OBJECT_TYPE_ROOT,
            SECT_FREE,
            if streams.is_empty() { SECT_FREE } else { 1 },
            mini_stream_start,
            mini_stream.len() as u64,
        );
        for (index, (name, data)) in streams.iter().enumerate() {
            let placement = placements
                .iter()
                .find(|(stream_index, _, _)| *stream_index == index)
                .expect("placement");
            let right = if index + 1 < streams.len() {
                index as u32 + 2
            } else {
                SECT_FREE
            };
            write_entry(
                &mut directory,
                name,
                OBJECT_TYPE_STREAM,
                right,
                SECT_FREE,
                placement.1,
                data.len() as u64,
            );
        }
        while directory.len() % SECTOR != 0 {
            directory.push(0);
        }
        let _ = entry_count;
        let dir_start = append_data(&mut sectors, &mut fat, &directory);

        // FAT sectors themselves.
        let fat_entry_count = fat.len() + 8; // room for FAT sectors marked below
        let fat_sector_count = (fat_entry_count * 4).div_ceil(SECTOR);
        let mut fat_full = fat.clone();
        let fat_start = sectors.len() as u32;
        for index in 0..fat_sector_count {
            fat_full.push(0xFFFF_FFFD); // FATSECT marker
            let _ = index;
        }
        while fat_full.len() * 4 % SECTOR != 0 {
            fat_full.push(SECT_FREE);
        }
        let fat_bytes: Vec<u8> = fat_full.iter().flat_map(|value| value.to_le_bytes()).collect();
        for chunk in fat_bytes.chunks(SECTOR) {
            let mut sector = [0u8; SECTOR];
            sector[..chunk.len()].copy_from_slice(chunk);
            sectors.push(sector);
        }

        // Header.
        let mut header = [0u8; SECTOR];
        header[..8].copy_from_slice(&CFB_SIGNATURE);
        header[24..26].copy_from_slice(&0x003Eu16.to_le_bytes());
        header[26..28].copy_from_slice(&3u16.to_le_bytes());
        header[28..30].copy_from_slice(&0xFFFEu16.to_le_bytes());
        header[30..32].copy_from_slice(&9u16.to_le_bytes());
        header[32..34].copy_from_slice(&6u16.to_le_bytes());
        header[44..48].copy_from_slice(&(fat_sector_count as u32).to_le_bytes());
        header[48..52].copy_from_slice(&dir_start.to_le_bytes());
        header[56..60].copy_from_slice(&4096u32.to_le_bytes());
        header[60..64].copy_from_slice(&mini_fat_start.to_le_bytes());
        header[64..68].copy_from_slice(&1u32.to_le_bytes());
        header[68..72].copy_from_slice(&SECT_END_OF_CHAIN.to_le_bytes());
        for index in 0..109 {
            let value = if index < fat_sector_count {
                fat_start + index as u32
            } else {
                SECT_FREE
            };
            header[76 + index * 4..80 + index * 4].copy_from_slice(&value.to_le_bytes());
        }

        let mut file = header.to_vec();
        for sector in sectors {
            file.extend_from_slice(&sector);
        }
        file
    }

    #[test]
    fn rejects_non_cfb_input() {
        assert!(CompoundFile::parse(b"PK\x03\x04not a cfb").is_err());
    }

    #[test]
    fn reads_mini_stream_entries() {
        let file = build_cfb(&[("WordDocument", b"hello mini stream".as_slice())]);
        let cfb = CompoundFile::parse(&file).expect("parse cfb");
        assert_eq!(cfb.stream("WordDocument").expect("stream"), b"hello mini stream");
    }

    #[test]
    fn reads_regular_fat_entries() {
        let big: Vec<u8> = (0..10_000u32).map(|value| (value % 251) as u8).collect();
        let file = build_cfb(&[("WordDocument", big.as_slice()), ("1Table", b"table data".as_slice())]);
        let cfb = CompoundFile::parse(&file).expect("parse cfb");
        assert_eq!(cfb.stream("WordDocument").expect("stream"), big.as_slice());
        assert_eq!(cfb.stream("1Table").expect("table"), b"table data");
    }
}
