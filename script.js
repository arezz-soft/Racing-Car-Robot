/* ============================================================
   SMART CAR WEBSITE — script.js
   ============================================================ */

/* ---- NAV active link on scroll ---- */
const sections = document.querySelectorAll('section');
const navLinks = document.querySelectorAll('.nav-links a');

const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      navLinks.forEach(a => {
        a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id);
      });
    }
  });
}, { threshold: 0.4 });
sections.forEach(s => observer.observe(s));

/* ---- Scroll reveal ---- */
const revealObs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

/* ============================================================
   PAGE 5 — ARDUINO CODE DISPLAY
   ============================================================ */
const arduinoCode = `
#include <Arduino.h>
#define enA 10
#define in1 9
#define in2 8
#define in3 7
#define in4 6
#define enB 5
#define R_S A0
#define L_S A1
#define echo A2
#define trigger A3
#define trigger_L 2
#define echo_L 3
#define trigger_R 4
#define echo_R 11

// Calibrate independently: set to the raw reading on WHITE.
const byte WHITE_LEFT_LEVEL=LOW, WHITE_RIGHT_LEVEL=LOW;
// Starting PWM settings; tune on the physical car (0-255).
const int CRUISE_PWM=160, LINE_STEER_PWM=30;
const int AVOID_BASE_PWM=150, AVOID_STEER_PWM=45;
const int WALL_STEER_PWM=25, MIN_MOVING_PWM=95, MAX_PWM=220;
// All three thresholds must be met to stop.
const int FRONT_CLOSE_CM=50, SIDE_CLOSE_CM=20, FRONT_RELEASE_CM=60;
const int SIDE_CHOICE_MARGIN_CM=12;
const unsigned long PING_INTERVAL_MS=65, STALE_MS=500;
const byte FRONT=0, LEFT=1, RIGHT=2;
long distanceCm[3]={250,250,250};
bool validRange[3]={false,false,false};
unsigned long measuredAt[3]={0,0,0}, lastPing=0, lastPrint=0;
byte pingStep=0;
int avoidanceDirection=0, lastTurnDirection=1; // +1 left, -1 right
int commandedLeft=0, commandedRight=0;
const char *statusText="START";
void forword(); void backword(); void turnRight(); void turnLeft(); void Stop();

int clampPWM(int value) {
  if(value<MIN_MOVING_PWM) return MIN_MOVING_PWM;
  if(value>MAX_PWM) return MAX_PWM;
  return value;
}
bool fresh(byte side) {
  return validRange[side] && millis()-measuredAt[side]<=STALE_MS;
}
bool closeTo(byte side,int threshold) {
  return fresh(side) && distanceCm[side]<=threshold;
}
void driveForwardCurve(int basePWM,int steeringPWM) {
  // Positive steering slows LEFT wheels and speeds RIGHT wheels.
  commandedLeft=clampPWM(basePWM-steeringPWM);
  commandedRight=clampPWM(basePWM+steeringPWM);
  forword(); // Preserve your original direction truth table.
  analogWrite(enA,commandedRight);
  analogWrite(enB,commandedLeft);
}
void stopAllBlocked() {
  Stop(); analogWrite(enA,0); analogWrite(enB,0);
  commandedLeft=commandedRight=0; avoidanceDirection=0;
  statusText="STOP: FRONT + LEFT + RIGHT CLOSE";
}
void readUltrasonic(byte trigPin,byte echoPin,byte side) {
  digitalWrite(trigPin,LOW); delayMicroseconds(2);
  digitalWrite(trigPin,HIGH); delayMicroseconds(10);
  digitalWrite(trigPin,LOW);
  unsigned long duration=pulseIn(echoPin,HIGH,15000UL);
  long cm=duration/58UL;
  validRange[side]=duration!=0 && cm>=2 && cm<=250;
  distanceCm[side]=validRange[side]?cm:250;
  measuredAt[side]=millis();
}
void updateUltrasonics() {
  if(millis()-lastPing<PING_INTERVAL_MS) return;
  lastPing=millis();
  // One transmitter at a time: front, left, front, right.
  switch(pingStep) {
    case 0: case 2: readUltrasonic(trigger,echo,FRONT); break;
    case 1: readUltrasonic(trigger_L,echo_L,LEFT); break;
    case 3: readUltrasonic(trigger_R,echo_R,RIGHT); break;
  }
  pingStep=(pingStep+1)%4;
}
int chooseCurve(bool leftClose,bool rightClose) {
  if(leftClose && !rightClose) return -1;
  if(rightClose && !leftClose) return 1;
  bool knownL=fresh(LEFT),knownR=fresh(RIGHT);
  if(knownL && knownR) {
    long difference=distanceCm[LEFT]-distanceCm[RIGHT];
    int margin=avoidanceDirection==0?0:SIDE_CHOICE_MARGIN_CM;
    if(difference>margin) return 1;
    if(difference<-margin) return -1;
  } else if(knownL && !leftClose) return 1;
  else if(knownR && !rightClose) return -1;
  // Unknown/tied clearance: retain previous choice. This is not proof of safety.
  return avoidanceDirection!=0?avoidanceDirection:lastTurnDirection;
}
void controlCar() {
  bool f=closeTo(FRONT,FRONT_CLOSE_CM);
  bool l=closeTo(LEFT,SIDE_CLOSE_CM),r=closeTo(RIGHT,SIDE_CLOSE_CM);
  // ONLY operational stop condition:
  if(f && l && r) { stopAllBlocked(); return; }
  bool keepTurning=avoidanceDirection!=0 && fresh(FRONT) &&
                   distanceCm[FRONT]<FRONT_RELEASE_CM;
  if(f || keepTurning) {
    avoidanceDirection=chooseCurve(l,r);
    lastTurnDirection=avoidanceDirection;
    statusText=avoidanceDirection>0?"CURVE LEFT: FRONT OBSTACLE":"CURVE RIGHT: FRONT OBSTACLE";
    driveForwardCurve(AVOID_BASE_PWM,avoidanceDirection*AVOID_STEER_PWM);
    return; // Ultrasonic avoidance takes priority over the white line.
  }
  avoidanceDirection=0;
  if(l && !r) {
    statusText="CURVE RIGHT: LEFT WALL";
    driveForwardCurve(CRUISE_PWM,-WALL_STEER_PWM); return;
  }
  if(r && !l) {
    statusText="CURVE LEFT: RIGHT WALL";
    driveForwardCurve(CRUISE_PWM,WALL_STEER_PWM); return;
  }
  if(l && r) {
    statusText="FORWARD: SIDES CLOSE, FRONT OPEN";
    driveForwardCurve(CRUISE_PWM,0); return;
  }
  bool whiteL=digitalRead(L_S)==WHITE_LEFT_LEVEL;
  bool whiteR=digitalRead(R_S)==WHITE_RIGHT_LEVEL;
  if(whiteL && !whiteR) {
    statusText="CURVE LEFT: WHITE LINE";
    driveForwardCurve(CRUISE_PWM,LINE_STEER_PWM);
  } else if(whiteR && !whiteL) {
    statusText="CURVE RIGHT: WHITE LINE";
    driveForwardCurve(CRUISE_PWM,-LINE_STEER_PWM);
  } else {
    // No white: no searching or extra turn. Both white: straight.
    statusText=whiteL?"FORWARD: BOTH WHITE":"FORWARD: NO WHITE";
    driveForwardCurve(CRUISE_PWM,0);
  }
}
void setup() {
  pinMode(enA,OUTPUT); pinMode(enB,OUTPUT);
  pinMode(in1,OUTPUT); pinMode(in2,OUTPUT);
  pinMode(in3,OUTPUT); pinMode(in4,OUTPUT);
  analogWrite(enA,0); analogWrite(enB,0); // Pin initialisation only.
  pinMode(R_S,INPUT_PULLUP); pinMode(L_S,INPUT_PULLUP);
  pinMode(echo,INPUT); pinMode(trigger,OUTPUT);
  pinMode(echo_L,INPUT); pinMode(trigger_L,OUTPUT);
  pinMode(echo_R,INPUT); pinMode(trigger_R,OUTPUT);
  digitalWrite(trigger,LOW); digitalWrite(trigger_L,LOW); digitalWrite(trigger_R,LOW);
  Serial.begin(115200);
  lastPing=millis()-PING_INTERVAL_MS;
  statusText="FORWARD: IMMEDIATE START";
  driveForwardCurve(CRUISE_PWM,0); // No delay and no remote needed.
}
void loop() {
  updateUltrasonics(); controlCar();
  if(millis()-lastPrint>=300UL) {
    lastPrint=millis(); Serial.print("F/L/R cm: ");
    for(byte i=0;i<3;i++) {
      if(fresh(i)) Serial.print(distanceCm[i]); else Serial.print("UNKNOWN");
      Serial.print(' ');
    }
    Serial.print("| IR raw L/R: "); Serial.print(digitalRead(L_S));
    Serial.print('/'); Serial.print(digitalRead(R_S));
    Serial.print(" | PWM L/R: "); Serial.print(commandedLeft);
    Serial.print('/'); Serial.print(commandedRight);
    Serial.print(" | "); Serial.println(statusText);
  }
}

// Motor Functions -- EXACTLY AS PROVIDED
void forword() {
  digitalWrite(in1, HIGH); digitalWrite(in2, LOW);
  digitalWrite(in3, LOW);  digitalWrite(in4, HIGH);
}

void backword() {
  digitalWrite(in1, LOW);  digitalWrite(in2, HIGH);
  digitalWrite(in3, HIGH); digitalWrite(in4, LOW);
}

void turnRight() {
  digitalWrite(in1, LOW);  digitalWrite(in2, HIGH);
  digitalWrite(in3, LOW);  digitalWrite(in4, HIGH);
}

void turnLeft() {
  digitalWrite(in1, HIGH); digitalWrite(in2, LOW);
  digitalWrite(in3, HIGH); digitalWrite(in4, LOW);
}

void Stop() {
  digitalWrite(in1, LOW); digitalWrite(in2, LOW);
  digitalWrite(in3, LOW); digitalWrite(in4, LOW);
}

`;

/* ---- Syntax highlight (line-by-line to prevent regex cross-contamination) ---- */
function highlight(code) {
  const keywords = ['void', 'int', 'bool', 'return', 'if', 'else', 'while', 'for',
                    'delay', 'true', 'false', 'const', 'unsigned', 'long'];

  return code.split('\n').map(line => {
    // 1. HTML escape
    line = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 2. Split comment from code (find // not inside a string)
    let commentPart = '';
    let inStr = false, commentIdx = -1;
    for (let i = 0; i < line.length - 1; i++) {
      if (line[i] === '"') inStr = !inStr;
      if (!inStr && line[i] === '/' && line[i + 1] === '/') { commentIdx = i; break; }
    }
    if (commentIdx >= 0) {
      commentPart = `<span class="cm">${line.slice(commentIdx)}</span>`;
      line = line.slice(0, commentIdx);
    }

    // 3. Strings (only in code part, not comment)
    line = line.replace(/"([^"]*)"/g, '<span class="str">"$1"</span>');
    // 4. Numbers
    line = line.replace(/\b(\d+)\b/g, '<span class="num">$1</span>');
    // 5. Preprocessor
    line = line.replace(/(#\w+)/g, '<span class="mc">$1</span>');
    // 6. Keywords
    keywords.forEach(kw => {
      line = line.replace(new RegExp(`\\b${kw}\\b`, 'g'), `<span class="kw">${kw}</span>`);
    });
    // 7. Functions (identifier before '(')
    line = line.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="fn">$1</span>');

    return line + commentPart;
  }).join('\n');
}

const cleanCode = arduinoCode.trim();
const lines = cleanCode.split('\n');
const lineNumsEl = document.getElementById('lineNums');
const codeBlockEl = document.getElementById('codeBlock');

lineNumsEl.innerHTML = lines.map((_, i) => `<span>${i + 1}</span>`).join('');
codeBlockEl.innerHTML = highlight(cleanCode);

/* ---- Trap mouse wheel inside code window so page doesn't scroll ---- */
const codeBodyEl = document.querySelector('.code-body');
codeBodyEl.addEventListener('wheel', function (e) {
  const atTop    = codeBodyEl.scrollTop === 0;
  const atBottom = codeBodyEl.scrollTop + codeBodyEl.clientHeight >= codeBodyEl.scrollHeight;
  // Only let the event bubble when already at the edge
  if (!(atTop && e.deltaY < 0) && !(atBottom && e.deltaY > 0)) {
    e.stopPropagation();
  }
}, { passive: true });

/* ---- Copy button ---- */
document.getElementById('copyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(cleanCode).then(() => {
    const msg = document.getElementById('copyMsg');
    msg.classList.add('show');
    setTimeout(() => msg.classList.remove('show'), 2500);
  });
});

/* ============================================================
   FOOTER — BACK TO TOP
   ============================================================ */
const backToTopBtn = document.getElementById('backToTop');

window.addEventListener('scroll', () => {
  if (window.scrollY > 500) {
    backToTopBtn.style.opacity = '1';
    backToTopBtn.style.pointerEvents = 'auto';
  } else {
    backToTopBtn.style.opacity = '0';
    backToTopBtn.style.pointerEvents = 'none';
  }
});

backToTopBtn.addEventListener('click', () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
});

/* ---- Handle Newsletter Submission (UI only) ---- */
const newsletterForm = document.querySelector('.newsletter-form');
if (newsletterForm) {
  newsletterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = newsletterForm.querySelector('button');
    const input = newsletterForm.querySelector('input');
    
    // Simple visual feedback
    const originalContent = btn.innerHTML;
    btn.innerHTML = '✓';
    btn.style.background = '#28c840';
    input.value = '';
    input.placeholder = 'Subscribed!';
    input.disabled = true;
    
    setTimeout(() => {
      btn.innerHTML = originalContent;
      btn.style.background = '';
      input.placeholder = 'Your email address';
      input.disabled = false;
    }, 3000);
  });
}
