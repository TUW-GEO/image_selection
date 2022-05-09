/*
  DoRIAH Image Selection - Visualization
  ip: Ignacio Perez-Messina
  TODO
  + abstract timebin visualization
  + add attack records with lines that follow all the way
  + calculate real coverages
  + add hovering interaction
*/

let aerials = [];
let aoi = [];
let footprints = {};
let availability = {};
let timebins = [];
let aerialDates = [];
let attackDates = [];
let currentTimebin = '';
let hovered = '';
let data;
let visible = [];

//// SKETCH

function preload() {
  attacks = loadTable('data/Attack_List_St_Poelten.xlsx - Tabelle1.csv', 'header').rows;
}

function setup() {
  cnv = createCanvas(windowWidth,windowHeight);
  frameRate(14);
  // only for st. Poelten attack records
  attackDates = attacks.map( a => a.obj.DATUM).slice(0,attacks.length-1).map( a => {let d = a.split('/'); return d[2]+(d[1].length==1?'-0':'-')+d[1]+(d[0].length==1?'-0':'-')+d[0]});
}

function draw() {
  hovered = resolveMouse();
  // sendObject(visible.filter( a => dist(a.visualization.pos[0], a.visualization.pos[1], mouseX, mouseY) <= a.visualization.size), 'hover');

  background(236);
  textSize(8), fill(0), noStroke();
  translate (0, 12);
  drawTimeline();
  if (currentTimebin === '') drawTimemap();
  else drawTimebin(currentTimebin);
  // debug();

  attackDates.forEach( a => drawAttack(a, 4))
}

//// VISUALIZATION

const drawAttack = function (attack, r) {
  let c = hovered === attack? color(255,130,20):56;
  push(), translate(timelinemap(attack),-r);
  strokeWeight(r/2), stroke(c);
  line(0,0,0,r);
  fill(c), noStroke();
  beginShape();
  vertex(0,-r/2), vertex(r/2,-r), vertex(r/2,0), vertex(0,r/2);
  vertex(-r/2,0),  vertex(-r/2,-r), vertex(0,-r/2);
  endShape();
  pop();
}

const drawViewfinder = function (timebin, r) {
  let flights = timebin.map( a => a.meta.Sortie ).filter(onlyUnique);
  let details = timebin.filter(a => a.meta.MASSTAB <= 20000);
  let overviews = timebin.filter ( a => a.meta.MASSTAB > 20000);

  const getMaxCvg = function (aerials) {
    return max(aerials.map( a=> a.meta.Abd));
  }
  const getPaired = function (aerials, flights) {
    return flights.reduce( (v, flight) => {
      let flightAerials = aerials.filter( a => a.meta.Sortie === flight);
      return v || (flightAerials.reduce ( (agg, a) => agg+(a.meta.Abd==100?1:0), 0) >= 2? true:false);
    }, false)
  }

  noStroke(), fill(166, getMaxCvg(overviews)==100?255:0);
  if (getMaxCvg(overviews)==100) arc(0,0,r,r,0,PI, CHORD);
  fill(166,getPaired(overviews,flights)?255:0);
  if (getPaired(overviews,flights)) arc(0,0,r,r,PI,0, CHORD);
  stroke(236), strokeWeight(1), fill(getMaxCvg(details)==100?100:236);
  arc(0,0,r/2,r/2,0,PI, CHORD);
  stroke(236), fill(getPaired(details,flights)?100:236);
  if (getPaired(details,flights) || getPaired(overviews,flights)) arc(0,0,r/2,r/2,PI,0, CHORD);
  
}

const timelinemap = function (datum) {
  return map(Date.parse(datum),Date.parse(aerialDates[0]),Date.parse(aerialDates[aerialDates.length-1]), 20, width-20);
}

const drawTimeline = function () {
  let years = aerialDates.map( a => a.slice(0,4)).filter(onlyUnique);
  textAlign(CENTER), textStyle(NORMAL), textFont('Helvetica'), textSize(11), fill(136);
  years.forEach( a => text(a,timelinemap(a.concat('-01-01')),-4));
  aerialDates.forEach( a => {
    let x = timelinemap(a);
    strokeWeight(a===hovered || a===currentTimebin? 1:.2), noFill(), stroke(126);
    line(x,5,x,0)
  });
}

const drawTimemap = function () {
  aerialDates.forEach( a => {
    let x = timelinemap(a);
    let x2 = map(aerialDates.indexOf(a),0,aerialDates.length-1, 20, width-20);
    fill(230,140,20,60), noStroke();
    if (a===hovered) rect(x2-10,80,20,height-24-80);
    let c = a === currentTimebin? color(255,30,30):color(126);

    let timebin = aerials.filter( b => b.meta.Datum === a);
    // Aerial display
    if (height >= 150) {
      timebin.filter( b => b.meta.Datum === a)
      .sort( (a,b) => new String(a.meta.Bildnr).slice(1) < new String(b.meta.Bildnr).slice(1) ? 1:-1 )
      .sort( (a,b) => a.meta.Sortie > b.meta.Sortie?1:-1)
      .forEach( (b, i, arr) => {
        push(), translate(x2,min(80+i*20,map(i,0,arr.length,80,height-20)));
        drawAerial(b);
        pop();
      })
    }

    strokeWeight(a===hovered? 1:.2), noFill(), stroke(c);
    line(x,5,x2,min(55,height-35))
    push(), noStroke(), fill(100), textStyle(NORMAL), textSize(8);
    text(a.slice(5).slice(a.slice(5,6)==='0'?1:0).replace('-','.'),x2,height-12), pop();

    push(), translate(x2,min(55,height-35));
    drawViewfinder(timebin,20);
    pop();
  });

}

const drawTimebin = function (aerialDate) {
  visible = [];
  noStroke(), fill(126), textSize(9);
  text(currentTimebin,timelinemap(currentTimebin),20);

  let timebin = aerials.filter( a => a.meta.Datum === aerialDate);
  // let flights = timebin.map( a => a.meta.Sortie ).filter(onlyUnique);
  let details = timebin.filter(a => a.meta.MASSTAB <= 20000);
  // let detailsR = timebin.filter( a => a.meta.Bildnr >=3000  && a.meta.Bildnr < 4000 && a.meta.MASSTAB <= 20000);
  // let detailsL = timebin.filter( a => a.meta.Bildnr >= 4000 && a.meta.Bildnr < 5000 && a.meta.MASSTAB <= 20000);
  let overviews = timebin.filter ( a => a.meta.MASSTAB > 20000);

  const drawTimebinRow = function(aerialRow, r) {
    // if (aerialRow.length > 1) {
    //   let agg = [];
    //   aerialRow.forEach( a => {
    //     if (agg.length == 0) agg.push(a);
    //     else agg.forEach( b => {
    //       if (!Array.isArray(b) && b.meta.Sortie === a.meta.Sortie && new String(a.meta.Bildnr).slice(1) === new String(b.meta.Bildnr).slice(1)) {
    //         agg.splice(agg.indexOf(b),1 );
    //         agg.push([b,a]);
    //       }
    //       else agg.push(a);
    //     });
        
    //   })
    //   aerialRow = agg.map( a => Array.isArray(a)?a:[a]);
    // }
    // console.log(aerialRow);
    
    // aerialRow = aerialRow.reduce( (agg, a) => {
    //   let pair = agg.forEach( b => {
    //     if (b.length == 1 && b[0].meta.Sortie === a.meta.Sortie && new String(a.meta.Bildnr).slice(1) === new String(b[0].meta.Bildnr).slice(1)) b.push(a)
    //     else agg.push([a]);
    //     return agg; 
    //   });
    //   filter( b => b.length == 1 && b[0].meta.Sortie === a.meta.Sortie && new String(a.meta.Bildnr).slice(1) === new String(b[0].meta.Bildnr).slice(1));
    //   console.log(agg);
    //   console.log(pair);
    //   pair.length == 1? agg[agg.indexOf(pair)].push(a):agg.push([a]);
    //   return agg;
    // }, []);
    // console.log(aerialRow);
    aerialRow.sort( (a,b) => new String(a.meta.Bildnr).slice(1) < new String(b.meta.Bildnr).slice(1) ? 1:-1 ).sort( (a,b) => a.meta.Sortie > b.meta.Sortie?1:-1);
    // draw flight arcs
    aerialRow.forEach( (a,i,arr) => { 
      let p = i/(arr.length-1)*PI-PI/2;
      push(), translate(width/2,55), rotate(-i/(arr.length-1)*PI+PI/2);
      stroke(220), noFill(), strokeWeight(5);
      if (i > 0 && a.meta.Sortie == arr[i-1].meta.Sortie) arc(0,0,r*2,r*2,PI/2,PI/2+PI/(arr.length-1));
      pop();
    });
    // draw aerials
    aerialRow.forEach( (a,i,arr) => { 
      let p = -i/(arr.length-1)*PI+PI/2;
      // let x = width/2+sin(p)*r;
      // let y = 55+cos(p)*r;
      // a.visualization.pos = [x,y];
      // a.visualization.size = sqrt(a.meta.Abd/a.meta.MASSTAB)*200; // taken from drawAerial
      // visible.push(a);
      push(), translate(width/2,55), rotate(p);
      translate(0,r);
      drawAerial(a);
      noStroke(), fill(0), textStyle(NORMAL), textSize(6), textAlign(CENTER);
      if (PI*(r+20)/arr.length > 22) text(a.meta.Bildnr,0,20);
      textAlign(CENTER), textStyle(BOLD), rotate(-PI/2);
      if (i == 0 || arr[i-1].meta.Sortie!==a.meta.Sortie) text(a.meta.Sortie,0,i==0?-20:-PI*r/arr.length/4);
      pop();
    });
  }
  push(), translate(width/2,55);
  drawViewfinder(timebin, 40), pop();
  drawTimebinRow(details, height-130);
  drawTimebinRow(overviews, height-90);

  // timebin.forEach( (a, i, arr) => {
  //   push(), translate(map(i,-1,arr.length,0,width),height-60);
  //   timebin.forEach( (b,j) => {
  //     if (j > i && a.meta.Sortie === b.meta.Sortie && a.meta.Abd+b.meta.Abd >= 200 ) {
  //       let l = width/(timebin.length+1)*(j-i);
  //       strokeWeight((a.meta.Abd+b.meta.Abd-100)/20), stroke(a.meta.Abd+b.meta.Abd == 200? color(0,20):color(0,20)), noFill();
  //       arc(l/2,0,l,l/4,-PI, 0);
  //     }
  //   })
  //   pop();
  // });
  // timebin.forEach( (a, i, arr) => {
  //   let R = (height-110);
  //   let p = i/(arr.length-1)*PI-PI/2;
  //   let x = width/2+sin(p)*R;
  //   let y = 55+cos(p)*R;
  //   timebin.forEach( (b,j) => {
  //     let p2 = j/(arr.length-1)*PI-PI/2;
  //     let x2 = width/2+sin(p2)*R;
  //     let y2 = 55+cos(p2)*R;
  //     if (j > i && a.meta.Sortie === b.meta.Sortie && a.meta.Abd+b.meta.Abd >= 200 ) {
  //       strokeWeight((a.meta.Abd+b.meta.Abd-100)/20), stroke(a.meta.Abd+b.meta.Abd == 200? color(0,20):color(0,20)), noFill();
  //       let k = R;
  //       let p3 = (p+p2)/2;
  //       let x3 = width/2+sin(p3)*k;
  //       let y3 = 55+cos(p3)*k;
  //       let d = dist(x,y,x2,y2);
  //       let r = dist(x,y,x3,y3);
  //       let angle = 2*atan(d/2,r);
  //       let h = (d/2)/sin(angle);
  //       push(), translate(width/2,55), rotate(-(p+p2)/2+PI/2);
        // arc(k,0,r,r,-angle/2,angle/2);
        // arc(k,0,r,r,angle/2,-angle/2);
        // pop();
        // let p0 = ((j+i)/2)/(arr.length-1)*PI-PI/2;
        // let x0 = width/2+sin(p0)*(height-mouseX);
        // let y0 = 55+cos(p0)*(height-mouseX);
        // x0 = width/2;
        // y0 = 55;
        // push(), translate((height-mouseX),(height-mouseX));
        // drawArc(x0,y0,x2,y2,x,y);
        // pop();
        
        // line(x,y,x2,y2);
  //     }
  //   })
  // });
}

const drawAerial = function (aerial) {
  let r = sqrt(aerial.meta.Abd/aerial.meta.MASSTAB)*200;
  let nr = new String(aerial.meta.Bildnr);
  let mod = nr.slice(0,1) === '3'? -5:nr.slice(0,1) === '4'?5:0;
  push(), stroke(0), strokeWeight(.8), drawingContext.setLineDash(aerial.meta.Abd == 100? 1:[2, 2]);
  fill(aerial.meta.LBDB? [238,195,99]:160);
  ellipse(-mod,0,r);
  pop();
}

//// INTERACTION

const resolveMouse = function () {
  if (mouseY < 55) return '';
  else {
    if (currentTimebin === '') return aerialDates[floor(map(mouseX,10,width-10,0,aerialDates.length))];
    else return currentTimebin;
    // {
    //   return visible.filter( a => dist(a.visualization.pos[0], a.visualization.pos[1], mouseX, mouseY) <= a.visualization.size);
    // };
  }
   
}

function mouseClicked() {
  currentTimebin = resolveMouse();
  sendObject(aerials.filter( a => a.meta.Datum === currentTimebin).map(a => a.id), 'link');
  // sendObject(visible.filter( a => dist(a.visualization.pos[0], a.visualization.pos[1], mouseX, mouseY) <= a.visualization.size, 'link'));
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

//// COMMUNICATION

// wk
qgisplugin.aerialsLoaded.connect(function(_aerials) {
  console.log(JSON.stringify(_aerials, null, 4));
  aerials = _aerials.sort( (a,b) => a.meta.Datum > b.meta.Datum).filter( a => a.footprint);
  aerials.forEach( a => a.visualization = {});
  // timebins = aerials.reduce( (bins, a) => { // EACH AERIAL appears twice, ONE WITH META ONE WITH FOOTPRINT ALSO
  //   if (bins[bins.length-1].length == 0 || bins[bins.length-1][0] === a.meta.Datum) bins[bins.length-1].push(a.meta.Datum);
  //   else bins.push([a.meta.Datum]);
  //   return bins;
  // }, [[]] );
  aerialDates = aerials.map( a => a.meta.Datum).filter(onlyUnique);
  let flights = aerials.map( a => a.meta.Sortie).filter(onlyUnique);
  // data = {};
  // flights.forEach( flight => {
  //   flightAerials = aerials.filter( a => a.meta.Sortie === flight);
  //   details = flightAerials.filter( a => a.meta.MASSTAB <= 20000);
  //   overviews = flightAerials.filter( a => a.meta.MASSTAB > 20000);
  //   const analyze = function (arr) {
  //     let maxCvg = max(arr.map( a => a.meta.Abd));
  //     let paired = (arr.reduce( (agg, a) => agg+(a.meta.Abd==100?1:0), 0) >= 2);
  //     return {coverage: maxCvg, pair: paired}
  //   }
  //   data[flight] = {detail: analyze(details), overview: analyze(overviews)};
  // })
  // timebins.forEach( t => {

  // })

  // data = aerials.groupBy( a => a.meta.Sortie);
  // Object.keys(data).forEach( k => {
  //   data[k].detail = data[k].filter( a => a.meta.MASSTAB <= 20000);
  //   let coverage = max(data[k].detail.map( a => a.meta.Abd));
  //   let paired = (data[k].detail.filter( a => a.meta.Abd == 100).length >= 2)
  //   data[k].detail = {coverage: coverage, paired: paired};
  //   data[k].overview = data[k].filter( a => a.meta.MASSTAB > 20000);
  // })
  currentTimebin = '';
});
  
qgisplugin.areaOfInterestLoaded.connect(function(_aoi){
  console.log("Area of interest loaded: " + JSON.stringify(_aoi, null, 4));
  aoi = _aoi;
});

qgisplugin.aerialFootPrintChanged.connect(function(imgId, _footprint) {
  console.log("Footprint of " + imgId + " has changed to " + JSON.stringify(_footprint, null, 4));
  footprints[imgId] = _footprint;
  // this function is not being called yet and also there is no ellipses syntax
  // aerials = aerials.map( a => a.id === imgId? {...a, footprint: _footprint}: a);
});

qgisplugin.aerialAvailabilityChanged.connect(function(imgId, _availability, path){
  console.log("Availability of " + imgId + " has changed to: " + _availability + " with file path: " + path);
  // availability[imgId] = _availability;
});

qgisplugin.aerialUsageChanged.connect(function(imgId, usage){
  console.log("Usage of " + imgId + " has changed to " + usage);
});

// ip: uses the hidden link to send a text message to the plugin
const sendObject = function (object, interaction) {
  document.getElementById(interaction).href = "#" +  encodeURIComponent(JSON.stringify(object));
  document.getElementById(interaction).click();
}

//// DEBUGGING

const debug = function () {
  textAlign(LEFT), noStroke(), fill(0);
  aerials.forEach( (a,i) => {
    text(a.id+' '+a.footprint+' '+Date.parse(a.meta.Datum)+' '+a.meta.Datum.split('-')[2], 0, i*12);
  });
  // aoi.forEach( (a, i) => {
  //   text(a.x+' '+a.y, 400, 12*i);
  // })
  attackDates.forEach( (a,i) => {
    text(a, 400, 12*i);
  });
  // availability.entries.forEach( (a,i) => {
  //   text(a, 400, 12*i);
  // });
}

//// UTILS

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}