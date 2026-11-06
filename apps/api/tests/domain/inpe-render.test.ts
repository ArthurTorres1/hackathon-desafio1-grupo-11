import { describe,it,expect } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import { PNG } from 'pngjs';
import { assertInpeDecodeBudget,BDC_CRS,renderInpeScene } from '../../src/services/inpe-render.js';
import { assertInpeUrl,createInpeTransport,isPublicInpeAddress, type InpeNetworkDependencies } from '../../src/services/inpe-transport.js';
const base='https://data.inpe.br/bdc/data/s2-16d/v2/016/009/2026/10/16/S2-16D_V2_016009_20261016';
const assets={B04:`${base}_B04.tif`,B03:`${base}_B03.tif`,B02:`${base}_B02.tif`};
const bbox:[number,number,number,number]=[-60,-3,-59.999,-2.999];
const metadata={width:32,height:32,ModelPixelScale:[10,10,0],ModelTiepoint:[0,0,0,0,0,0],GTModelTypeGeoKey:1,GTRasterTypeGeoKey:1,GeographicTypeGeoKey:32767,ProjectedCSTypeGeoKey:32767,ProjCoordTransGeoKey:11,ProjLinearUnitsGeoKey:9001,ProjStdParallel1GeoKey:-2,ProjStdParallel2GeoKey:-22,ProjNatOriginLongGeoKey:-54,ProjNatOriginLatGeoKey:-12,ProjFalseEastingGeoKey:5000000,ProjFalseNorthingGeoKey:10000000};
describe('INPE bounded georeferenced renderer',()=>{
  it('bounds all decoded tiles for a thin crop instead of only its output pixels',()=>{
    expect(()=>assertInpeDecodeBudget([0,0,1,4096],4096,1,2)).not.toThrow();
    expect(()=>assertInpeDecodeBudget([0,0,1,4097],4096,1,2)).toThrow('Conjunto de blocos');
    expect(()=>assertInpeDecodeBudget([0,0,1,4096],NaN,1,2)).toThrow();
  });
  it('agrees with three independent STAC footprint control points within one output pixel',()=>{
    const projection=proj4(BDC_CRS,'EPSG:4326');
    const controls=[{pixel:[0,0],lonlat:[-60.19141463591476,-2.959791516989484]},{pixel:[0,10560],lonlat:[-60.21256392965003,-3.910790451705581]},{pixel:[10560,10560],lonlat:[-59.257030293813216,-3.9302648349457026]}];
    const mercator=(p:number[])=>[6378137*p[0]!*Math.PI/180,6378137*Math.log(Math.tan(Math.PI/4+p[1]!*Math.PI/360))];
    const a=mercator([-60,-3]),b=mercator([-59.99,-2.99]);
    for(const control of controls){
      const actual=mercator(projection.forward([4313600+control.pixel[0]!*10,11003200-control.pixel[1]!*10]));
      const expected=mercator(control.lonlat);
      expect(Math.hypot((actual[0]!-expected[0]!)/((b[0]!-a[0]!)/1024),(actual[1]!-expected[1]!)/((b[1]!-a[1]!)/1024))).toBeLessThan(1);
    }
  });
  it('renders actual georeferenced TIFF samples with RGB order, transparent partial coverage and bounded dimensions',async()=>{
    const [x,y]=proj4('EPSG:4326',BDC_CRS).forward([-60,-2.999]);
    const GeoKeyDirectory=[1,1,0,10,1024,0,1,1,1025,0,1,1,3075,0,1,11,3076,0,1,9001,3078,34736,1,0,3079,34736,1,1,3080,34736,1,2,3081,34736,1,3,3082,34736,1,4,3083,34736,1,5];
    const fixture=Buffer.from(writeArrayBuffer(new Uint16Array(32*32).fill(10000),{...metadata,GeoKeyDirectory,GeoDoubleParams:[-2,-22,-54,-12,5000000,10000000],ModelTiepoint:[0,0,0,x!+50,y!,0]}));
    const output=await renderInpeScene({assets,bbox},{maxSide:32,range:async(url,[start,end],budget)=>{
      const value=url.includes('B04')?10000:url.includes('B03')?5000:2500;
      const bandFixture=Buffer.from(writeArrayBuffer(new Uint16Array(32*32).fill(value),{...metadata,GeoKeyDirectory,GeoDoubleParams:[-2,-22,-54,-12,5000000,10000000],ModelTiepoint:[0,0,0,x!+50,y!,0]}));
      const body=bandFixture.subarray(start,Math.min(end+1,bandFixture.length));budget.bytes_read+=body.length;
      return {status:206,headers:{'content-range':`bytes ${start}-${start+body.length-1}/${fixture.length}`},body};
    }});
    const image=PNG.sync.read(output.png);
    expect(image.width).toBeLessThanOrEqual(32);expect(image.height).toBeLessThanOrEqual(32);
    const alpha=Array.from({length:image.width*image.height},(_,i)=>image.data[i*4+3]);
    expect(alpha).toContain(0);expect(alpha).toContain(255);
    const covered=alpha.indexOf(255)*4;
    expect([...image.data.subarray(covered,covered+4)]).toEqual([255,128,64,255]);
    expect(output.render_bounds).toEqual([[-60,-3],[-59.999,-2.999]]);
    expect(output.bytes_read).toBeLessThan(32*1024*1024);
  });
  it('rejects arbitrary assets and excessive dimensions before reading',async()=>{
    await expect(renderInpeScene({assets,bbox},{maxSide:1025})).rejects.toThrow();
    await expect(renderInpeScene({assets:{...assets,B02:'https://localhost/private.tif'},bbox})).rejects.toThrow();
  });
});
describe('INPE transport destination boundary',()=>{
  it.each(['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])('blocks nonpublic %s',ip=>expect(isPublicInpeAddress(ip)).toBe(false));
  it('allows public provider address and rejects arbitrary paths',()=>{
    expect(isPublicInpeAddress('150.163.2.10')).toBe(true);
    expect(()=>assertInpeUrl('https://data.inpe.br/other','catalog')).toThrow();
    expect(()=>assertInpeUrl('https://data.inpe.br@localhost/bdc/stac/v1/search','catalog')).toThrow();
  });
  it('pins resolved address and retries a transient HTTP failure only once',async()=>{
    let calls=0;
    const dependencies:InpeNetworkDependencies={lookup:async()=>[{address:'150.163.2.10',family:4}],request:async(_url,options)=>{
      expect(options.pinned.address).toBe('150.163.2.10');calls++;
      return {status:503,headers:{},body:Buffer.from('{}')};
    }};
    expect((await createInpeTransport(dependencies).json('https://data.inpe.br/bdc/stac/v1/search')).status).toBe(503);expect(calls).toBe(2);
  });
  it('rejects private DNS and a redirect outside the allowlist',async()=>{
    const deps:InpeNetworkDependencies={lookup:async()=>[{address:'127.0.0.1',family:4}],request:async()=>{throw Error('must not connect');}};
    await expect(createInpeTransport(deps).json('https://data.inpe.br/bdc/stac/v1/search')).rejects.toThrow('DNS');
    deps.lookup=async()=>[{address:'150.163.2.10',family:4}];deps.request=async()=>({status:302,headers:{location:'https://localhost/private'},body:Buffer.alloc(0)});
    await expect(createInpeTransport(deps).json('https://data.inpe.br/bdc/stac/v1/search')).rejects.toThrow();
  });
  it('rejects excessive JSON and deadline expiry without empty scenes',async()=>{
    const deps:InpeNetworkDependencies={lookup:async()=>[{address:'150.163.2.10',family:4}],request:async()=>({status:200,headers:{},body:Buffer.alloc(20)})};
    await expect(createInpeTransport(deps).json('https://data.inpe.br/bdc/stac/v1/search',{maxBytes:10})).rejects.toThrow();
    deps.lookup=()=>new Promise(()=>{});
    await expect(createInpeTransport(deps).json('https://data.inpe.br/bdc/stac/v1/search',{deadlineMs:5})).rejects.toThrow();
  });
  it('does not retry authentication failure and refuses full-file fallback',async()=>{
    let calls=0;
    const deps:InpeNetworkDependencies={lookup:async()=>[{address:'150.163.2.10',family:4}],request:async()=>{calls++;return {status:401,headers:{},body:Buffer.from('{}')};}};
    expect((await createInpeTransport(deps).json('https://data.inpe.br/bdc/stac/v1/search')).status).toBe(401);expect(calls).toBe(1);
    deps.request=async()=>({status:200,headers:{},body:Buffer.alloc(1)});
    await expect(createInpeTransport(deps).request(assets.B04,'asset',{signal:AbortSignal.timeout(100),maxBytes:100,range:[0,9]})).rejects.toThrow('Range');
  });
  it.each([429,500,502,503,504])('permits only one total asset retry for HTTP %s across all bands',async status=>{
    let calls=0;
    const deps:InpeNetworkDependencies={lookup:async()=>[{address:'150.163.2.10',family:4}],request:async()=>{calls++;return {status,headers:{},body:Buffer.alloc(0)};}};
    const transport=createInpeTransport(deps),budget={bytes_read:0,max_bytes:32*1024*1024,retries_remaining:1};
    const signal=AbortSignal.timeout(20_000);
    await expect(transport.range(assets.B04,[0,9],budget,signal)).rejects.toThrow();expect(calls).toBe(2);
    await expect(transport.range(assets.B03,[0,9],budget,signal)).rejects.toThrow();expect(calls).toBe(3);expect(budget.retries_remaining).toBe(0);
  });
  it('rejects malformed Range metadata and expired asset deadline',async()=>{
    let calls=0;
    const deps:InpeNetworkDependencies={lookup:async()=>[{address:'150.163.2.10',family:4}],request:async()=>{calls++;return {status:206,headers:{'content-range':'bytes 1-10/100'},body:Buffer.alloc(10)};}};
    const transport=createInpeTransport(deps),budget={bytes_read:0,max_bytes:100,retries_remaining:1};
    await expect(transport.range(assets.B04,[0,9],budget,AbortSignal.timeout(100))).rejects.toThrow('Content-Range');expect(calls).toBe(1);
    await expect(transport.range(assets.B04,[0,9],budget,AbortSignal.abort())).rejects.toThrow();expect(calls).toBe(1);
  });
});
