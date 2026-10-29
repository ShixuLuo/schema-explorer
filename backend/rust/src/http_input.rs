//! HTTP/1 framing only; payloads remain ordinary bounded JSON.
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

pub type Failure = (u16, &'static str);
#[derive(Debug, PartialEq)]
pub enum Framing { Empty, Length(usize), Chunked }
pub struct Head { pub method:String, pub path:String, pub origin:Option<String>, pub framing:Framing, pub expect_continue:bool }
fn io_error(e:io::Error)->Failure {if matches!(e.kind(),io::ErrorKind::TimedOut|io::ErrorKind::WouldBlock){(408,"request_timeout")}else{(400,"incomplete_request")}}
struct Deadline<'a> {stream:&'a mut TcpStream, until:Instant}
impl Read for Deadline<'_> {fn read(&mut self,buf:&mut[u8])->io::Result<usize>{let remaining=self.until.saturating_duration_since(Instant::now());if remaining.is_zero(){return Err(io::Error::new(io::ErrorKind::TimedOut,"request deadline"))}self.stream.set_read_timeout(Some(remaining.min(Duration::from_secs(5))))?;self.stream.read(buf)}}

pub fn read_head(stream:&mut TcpStream,max_body:usize)->Result<Head,Failure>{
 // BSD/macOS accept inherits O_NONBLOCK from the nonblocking listener. A partial
 // browser/proxy upload must wait for the next packet instead of becoming EOF.
 stream.set_nonblocking(false).map_err(io_error)?;
 let mut reader=Deadline{stream,until:Instant::now()+Duration::from_secs(5)};
 let mut bytes=Vec::new();while !bytes.ends_with(b"\r\n\r\n"){if bytes.len()>=16384{return Err((431,"headers_too_large"))}let mut b=[0];reader.read_exact(&mut b).map_err(io_error)?;bytes.push(b[0]);}
 parse_head(&bytes,max_body)
}
fn parse_head(bytes:&[u8],max_body:usize)->Result<Head,Failure>{
 let mut headers=[httparse::EMPTY_HEADER;64];let mut req=httparse::Request::new(&mut headers);
 if !req.parse(bytes).map_err(|_|(400,"invalid_http"))?.is_complete(){return Err((400,"invalid_http"))}
 let method=req.method.ok_or((400,"invalid_http"))?.to_owned();let path=req.path.ok_or((400,"invalid_http"))?.to_owned();
 let(mut length,mut transfer,mut origin,mut expect)=(None,None,None,false);
 for h in req.headers.iter(){let v=std::str::from_utf8(h.value).map_err(|_|(400,"invalid_header"))?.trim();
  if h.name.eq_ignore_ascii_case("content-length"){if length.is_some()||v.is_empty()||!v.bytes().all(|b|b.is_ascii_digit()){return Err((400,"invalid_content_length"))}let n=v.parse::<usize>().map_err(|_|(413,"request_limit"))?;if n>max_body{return Err((413,"request_limit"))}length=Some(n);}
  if h.name.eq_ignore_ascii_case("transfer-encoding"){if transfer.is_some(){return Err((400,"invalid_transfer_encoding"))}if !v.eq_ignore_ascii_case("chunked"){return Err((501,"unsupported_transfer_encoding"))}transfer=Some(());}
  if h.name.eq_ignore_ascii_case("origin"){if origin.is_some(){return Err((400,"duplicate_origin"))}origin=Some(v.to_owned());}
  if h.name.eq_ignore_ascii_case("expect"){if !v.eq_ignore_ascii_case("100-continue"){return Err((417,"unsupported_expectation"))}expect=true;}
 }
 if transfer.is_some()&&length.is_some(){return Err((400,"ambiguous_body_framing"))}
 let framing=if transfer.is_some(){Framing::Chunked}else if let Some(n)=length{Framing::Length(n)}else{Framing::Empty};
 if method=="POST"&&framing==Framing::Empty{return Err((411,"length_required"))}
 Ok(Head{method,path,origin,framing,expect_continue:expect})
}
pub fn read_body(stream:&mut TcpStream,head:&Head,max_body:usize)->Result<Vec<u8>,Failure>{
 if head.expect_continue {stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").map_err(io_error)?;}
 let mut reader=Deadline{stream,until:Instant::now()+Duration::from_secs(30)};
 decode_body(&mut reader,&head.framing,max_body)
}
fn line(reader:&mut impl Read,max:usize)->Result<Vec<u8>,Failure>{let mut v=Vec::new();loop{if v.len()>=max{return Err((400,"invalid_chunk_framing"))}let mut b=[0];reader.read_exact(&mut b).map_err(io_error)?;v.push(b[0]);if v.ends_with(b"\r\n"){v.truncate(v.len()-2);return Ok(v)}}}
fn decode_body(reader:&mut impl Read,framing:&Framing,max:usize)->Result<Vec<u8>,Failure>{
 match framing {
  Framing::Empty=>Ok(Vec::new()),
  Framing::Length(n)=>{if *n>max{return Err((413,"request_limit"))}let mut body=vec![0;*n];reader.read_exact(&mut body).map_err(io_error)?;Ok(body)},
  Framing::Chunked=>{let mut body=Vec::new();loop{let size=line(reader,1024)?;let token=size.split(|b|*b==b';').next().unwrap_or(&[]);if token.is_empty()||token.len()>16||!token.iter().all(u8::is_ascii_hexdigit){return Err((400,"invalid_chunk_size"))}let n=usize::from_str_radix(std::str::from_utf8(token).unwrap(),16).map_err(|_|(413,"request_limit"))?;if n==0 {let mut trailer_bytes=0;loop{let trailer=line(reader,4096)?;trailer_bytes+=trailer.len()+2;if trailer_bytes>4096{return Err((431,"trailers_too_large"))}if trailer.is_empty(){return Ok(body)}if !trailer.contains(&b':'){return Err((400,"invalid_trailer"))}}}if n>max.saturating_sub(body.len()){return Err((413,"request_limit"))}let start=body.len();body.resize(start+n,0);reader.read_exact(&mut body[start..]).map_err(io_error)?;let mut end=[0;2];reader.read_exact(&mut end).map_err(io_error)?;if end!=*b"\r\n"{return Err((400,"invalid_chunk_framing"))}}}
 }
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn chunked_body_preserves_bytes_and_handles_extensions_and_trailers(){let mut input=&b"1;safe=yes\r\n{\r\n1\r\n}\r\n0\r\nX-Test: value\r\n\r\n"[..];assert_eq!(decode_body(&mut input,&Framing::Chunked,16).unwrap(),b"{}");}
 #[test]fn truncated_and_over_limit_chunks_are_errors(){assert_eq!(decode_body(&mut &b"4\r\n{}"[..],&Framing::Chunked,16).unwrap_err().0,400);assert_eq!(decode_body(&mut &b"11\r\n"[..],&Framing::Chunked,16).unwrap_err().0,413);assert_eq!(decode_body(&mut &b"z\r\n"[..],&Framing::Chunked,16).unwrap_err().0,400);}
 #[test]fn ambiguous_or_duplicate_length_is_rejected(){for h in ["Content-Length: 2\r\nTransfer-Encoding: chunked","Content-Length: 2\r\nContent-Length: 2"]{let v=format!("POST / HTTP/1.1\r\n{h}\r\n\r\n");assert!(parse_head(v.as_bytes(),16).is_err())}}
 #[test]fn expect_and_chunked_head_parse(){let h=parse_head(b"POST /api/cql/runs HTTP/1.1\r\nTransfer-Encoding: chunked\r\nExpect: 100-continue\r\n\r\n",16).unwrap();assert!(h.expect_continue);assert_eq!(h.framing,Framing::Chunked);}
}
