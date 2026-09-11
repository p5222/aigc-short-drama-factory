#!/bin/sh
set -eu
output="${1:-/tmp/manjiao-ffmpeg-smoke.mp4}"
font="$(fc-match -f '%{file}' 'Noto Sans CJK SC')"
test -f "$font"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'color=c=0x172a3a:s=640x360:r=25:d=2' \
  -f lavfi -i 'anullsrc=r=48000:cl=stereo' \
  -vf "drawtext=fontfile=$font:text=漫交发布验收:fontcolor=white:fontsize=32:x=(w-tw)/2:y=(h-th)/2" \
  -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart "$output"
ffprobe -v error -show_streams -show_format -of json "$output" > "$output.json"
node -e 'const fs=require("node:fs"); const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const video=v.streams.find(s=>s.codec_type==="video"); const audio=v.streams.find(s=>s.codec_type==="audio"); if(video?.codec_name!=="h264"||video?.pix_fmt!=="yuv420p"||video?.width!==640||video?.height!==360||audio?.codec_name!=="aac"||Number(v.format.duration)<1.9)process.exit(1); console.log("FFMPEG_SMOKE_OK",JSON.stringify({video:video.codec_name,audio:audio.codec_name,width:video.width,height:video.height,duration:v.format.duration,bytes:v.format.size}));' "$output.json"
