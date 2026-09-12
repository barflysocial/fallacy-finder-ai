import json, re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'knowledge/fallacies.json'
data=json.loads(p.read_text())

# Local routing vocabulary. These are signals, never verdicts.
K={
1:["can't prove","cannot prove","no proof","not disproven","prove it isn't","prove it is not","absence of evidence"],
2:["prove you didn't","prove you did not","prove you're not","prove you are not","disprove it","show me i'm wrong","show me I’m wrong","you prove it"],
3:["prove you never","prove your intent","prove what you would have done","prove you'll never","prove you will never","guarantee you'll never","guarantee you will never"],
4:["therapist said","doctor said","expert said","lawyer said","book says","article says","professional said","authority says"],
5:["everyone says","everybody says","all my friends","most people","people online","everyone agrees","everybody agrees","normal people"],
6:["one time","once","last two times","a couple times","a few times","in my experience","i know someone","my friend did"],
7:["one time so","once so","this happened once","therefore always","so you're always","so you are always","one example proves","one incident proves"],
8:["these examples prove","look at these cases","all these examples","the pattern is obvious","picked examples","cluster of examples","only these cases"],
9:["only the times","only the examples","leave out","left out","omit","omitted","ignore the times","ignoring contrary","cherry pick","cherry-pick"],
10:["because it happened after","ever since","after that so","therefore caused","caused by","made this happen","that's why","that is why"],
11:["always happens when","every time x","whenever this happens","these two go together","linked every time","must be connected","correlated"],
12:["usually people","normally people","how often does that happen","base rate","most cases","typical case","ordinary explanation"],
13:["first thing i remember","comes to mind","easy to remember","vivid memory","i can picture it","most memorable","can't forget"],
14:["turned out badly","turned out fine","ended badly","ended well","nothing happened so","because it worked","because it failed","outcome proves"],
15:["i've told you for years","i have told you for years","keep saying","said it many times","everyone keeps saying","i keep telling you","repeatedly told"],
16:["it just is","yes you did","no you didn't","because i said","i know it","obviously","clearly","that's just true","that is just true"],
17:["you didn't say","you did not say","you were silent","no response","didn't mention","did not mention","you never denied","silence means"],
18:["both sides are equal","equally true","50/50","same weight","both versions","two sides so","meet in the middle"],
19:["that's a fallacy so","that is a fallacy so","bad reasoning so false","your logic is bad so you're wrong","fallacy therefore false","argument is flawed therefore false"],
20:["you wanted","you meant","you think","you feel","you believe","you only did","because you wanted","you secretly","i know why you","your real reason"],
21:["must be","obviously means","clearly means","so that means","therefore you must","i already know","no other reason","jumping to"],
22:["you only say that because","you only want","your motive is","you're just saying","you are just saying","only because you want","self-serving motive"],
23:["on purpose","intentionally","deliberately","specifically to","you meant to","you did that to","you knew it would and wanted","purposefully"],
24:["trying to hurt","trying to punish","trying to attack","hostile","disrespecting me","threatening me","trying to control","out to get me","malicious"],
25:["because of me","my fault","i caused it","i made them","they're quiet because of me","this is about me","i must have done"],
26:["you must feel","you are judging me","you secretly want","you must want","you probably feel","you're the one who","you think exactly what i think"],
27:["because your therapist","because your mother","because your father","because your family","because your friend","you got that from","came from social media","because of where it came from"],
28:["i can't understand","i cannot understand","makes no sense so","i would never","i can't imagine","impossible that","doesn't make sense to me so"],
29:["you should know","you knew what i meant","obvious what i meant","you should have known how i felt","you could tell","it was obvious i needed"],
30:["how could you not know","you should understand","everyone knows this context","you know the history","you already know why","i shouldn't have to explain"],
31:["i feel therefore","i feel like you","i felt so you","because i feel","feels true","i feel unsafe therefore","i feel controlled therefore","i feel rejected therefore"],
32:["if you loved me","if you cared","after everything i've done","look how upset","how can you say no when","because i'm hurt","because i’m hurt","you'd do it if you cared"],
33:["if i admit","if I admit","then it would mean","can't be true because that would","cannot be true because that would","if that were true then","too painful to be true"],
34:["that is control","that's control","that is abuse","that's abuse","that is abandonment","that's abandonment","that is disrespect","that's disrespect","this is manipulation"],
35:["either or","either you","or else","only two choices","all or nothing","completely or not at all","if not x then y"],
36:["marriage is over","never recover","always be this way","worst case","everything is ruined","this will destroy","it's hopeless","catastrophe"],
37:["you are a liar","you're a liar","you are selfish","you're selfish","you are controlling","you're controlling","you are needy","you're needy","you are toxic","you're toxic","you are cold","you're cold"],
38:["should","shouldn't","should not","supposed to","must always","ought to","good spouse would","real partner should","married people should"],
39:["will always","will never","going to happen","definitely will","eventually you'll","eventually you will","this will end in","i know what will happen"],
40:["checking versus tracking","space versus abandonment","independence versus distance","call it","framed as","same behavior different words","wording makes it sound"],
41:["everyone noticed","they all think","people are judging","everyone saw","the therapist thinks i'm","the therapist thinks I’m","everyone is focused on","they're all watching"],
42:["lately","recently","last week","last few days","right now","these last times","most recent"],
43:["only remember the bad","negative stands out","worst moments","all i remember is","can't stop thinking about the bad","one criticism outweighs"],
44:["should have known","obvious now","knew all along","warning signs were obvious","i should've seen","i should have seen","of course it happened"],
45:["first impression","first label","first story","anchored","started with the idea","initial number","first thing therapist said"],
46:["everyone remembers it that way","family says it happened","after hearing it repeatedly","retelling changed","shared story","they told me so often","now i remember it that way"],
47:["always wanted","never wanted","i've always","i have always","i never believed","always been this way","i was always like this"],
48:["used to be perfect","back then everything","good old days","before this everything worked","we were always happy then","things were simpler then"],
49:["doesn't feel as bad now","does not feel as bad now","not as painful now","i barely remember how bad","pain faded","seems minor now"],
50:["because they're good","because she is loving","because he is loving","because they're successful","good person so","great parent so","kind person so"],
51:["because they're bad","one bad thing means","everything about them is bad","bad person so","after what they did nothing good","one flaw colors everything"],
52:["always","never","every single time","constantly","nothing","everything","everyone","nobody","all you do","every time"],
53:["then this will lead to","and then it'll","and then it will","eventually this means","next thing you know","if this then eventually","chain reaction","slippery slope"],
54:["one part means the whole","this decision proves who you are","one session proves the whole","one behavior means the person","part therefore whole","this piece means all of it"],
55:["whole means every part","our relationship is so every moment","the group is so each person","because the whole is","every part must be","whole therefore part"],
56:["just like","same as","no different from","exactly like","basically the same as","equivalent to","that's like saying"],
57:["ruined everything","completely rejected","huge disaster","the entire weekend","worst ever","massive problem","blew it up","made it much bigger"],
58:["only yelling","just a text","not a big deal","just one time","only happened once","it's nothing","it was nothing","you're overreacting","barely matters"],
59:["any husband would","any wife would","any partner would","everyone knows spouses","most reasonable people","we all know","any normal person","everyone feels this way"],
60:["real husband","real wife","real partner","true husband","true wife","true partner","no real spouse would","if they were truly supportive","doesn't count because they're not really"],
61:["you're crazy","you are crazy","you're obsessed","you are obsessed","you're impossible","you are impossible","you're stupid","you are stupid","you're just emotional","you are just emotional","attack the person"],
62:["why do you keep","when will you stop","when did you stop","why are you always","why did you deliberately","why are you controlling","why do you refuse to","loaded question"],
63:["because it is","because you're","because you are","it's true because it's true","it is true because it is true","that proves itself","because that's what it is"],
64:["i only meant","I only meant","that's not what i meant","that is not what i meant","i didn't say always","i did not say always","retreat to","weaker claim","strong claim then weaker"],
65:["by support i mean","by support I mean","same word different meaning","that's not what support means","freedom means","safe means","respect means","changed the meaning","word means two things"],
66:["not enough anymore","now you need","that doesn't count","that does not count","i asked for x now y","standard changed","goalpost","even after you did that"],
67:["that's a different issue","that is a different issue","side issue","anyway what about","instead let's talk about","instead let us talk about","not answering the question","change the subject","unrelated point"],
68:["what about","but you","well you","and you did","what about when you","you did it too so","instead of answering you"],
69:["you do it too","you've done it","you have done it","you're a hypocrite","you are a hypocrite","same criticism applies to you","who are you to say"],
70:["before they answer know that","expect them to lie","they'll deny everything","they will deny everything","can't trust anything they say","cannot trust anything they say","they're defensive so","they are defensive so"],
71:["that's ridiculous","that is ridiculous","laughable","how romantic","what a joke","that's stupid","that is stupid","mocking","sarcastic dismissal"],
72:["always done it this way","we've always","we have always","tradition","that's how marriage works","that is how marriage works","because that's how it's always been","because that is how it has always been"],
73:["new way is better","modern is better","new therapy","latest approach","more evolved","newer must be","because it's new","because it is new"],
74:["natural so","human nature so","normal therefore","it's natural","it is natural","biological so","instinct so","natural means right"],
75:["so you're saying","so you are saying","so feelings mean nothing","so i need permission","so I need permission","you mean that","twist what i said","extreme version of what i said"],
76:["same thing","equally bad","both did","exactly equivalent","no different morally","same level","these are identical"],
77:["that's different","that is different","exception for me","my case is special","doesn't apply to me","does not apply to me","special case","rule applies except"],
78:["i can but you can't","I can but you can’t","i can but you cannot","different rules","double standard","okay when i do it","wrong when you do it","same act different rule"],
79:["only your part","we're not talking about me","we are not talking about me","only you need to change","your reaction only","my part is irrelevant","selective accountability"],
80:["because you're that kind of person","because you are that kind of person","that's who you are","that is who you are","you did it because you're","you did it because you are","character explains it","personality not situation"],
81:["i did it because","I did it because","you did it because","when i do it it's because","when you do it it's because","my circumstances your character","same behavior different explanation"],
82:["good because of me","bad because of you","when it works i did","when it fails you did","success is mine","failure is yours","credit me blame you"],
83:["had to","no choice","you made me","i was forced to","I was forced to","there was no alternative","what else could i do","what else could I do"],
84:["already invested","all these years","too much time","too much money","can't waste what we put in","cannot waste what we put in","we've come this far","we have come this far"],
85:["after all i do","after all I do","i deserve","I deserve","i earned the right","i sacrificed so","because i've been good","because I’ve been good","good deed earns exception"],
86:["got what they deserved","must have caused it","happened so deserved","bad thing happened so they must","people get what they deserve","if they suffered they caused"],
87:["if you win i lose","if you win I lose","either your needs or mine","one of us has to lose","your gain is my loss","can't both get needs met","cannot both get needs met"],
88:["did nothing","didn't do anything","did not do anything","i never acted","I never acted","inaction doesn't count","inaction does not count","i only stayed silent","I only stayed silent"],
89:["nothing bad happened","turned out fine","bad luck","good luck","because the outcome was okay","because the outcome was bad","result decides blame","luck changes morality"],
90:["confirms what i believe","confirms what I believe","only notice","everything fits my theory","see i was right","see I was right","ignore contrary","look for proof i'm right","look for proof I’m right"],
91:["even after evidence","still believe","doesn't matter what evidence","does not matter what evidence","i know anyway","I know anyway","evidence changed but belief didn't","evidence changed but belief did not"],
92:["evidence makes me more sure","proof makes me more convinced","correction proves i'm right","correction proves I’m right","the more you explain the more guilty","push back makes me believe more"],
93:["i'm just seeing reality","I’m just seeing reality","i'm objective","I’m objective","if you disagree you're biased","if you disagree you’re biased","any reasonable person sees","only i see it clearly","only I see it clearly"],
94:["i'm not biased","I’m not biased","you're biased","you’re biased","your fallacy","you always use fallacies","i don't have that bias","I don’t have that bias","bias is your problem"],
95:["denial proves it","asking proves it","defensiveness proves it","if you disagree that proves","the fact you deny it proves","needing evidence proves","anything you say proves"],
96:["either you","either this or","only two choices","if not this then that","all or nothing","choose one of two","no middle ground"],
97:["because you're selfish because","because you are selfish because","true because it is true","unsafe because i feel unsafe and","the conclusion proves itself","same claim as evidence","circular"],
98:["keep it the same","always been this way","status quo","why change now","this is how we've always","this is how we have always","familiar is safer","don't change what works","do not change what works"],
99:["don't tell me what to do","do not tell me what to do","because you asked me not to","now i want to because you said no","now I want to because you said no","i'll do the opposite","I’ll do the opposite","resist because controlled"],
100:["my family","my side","our people","people like us","outsider","they're one of us","they are one of us","i trust them because they're family","I trust them because they’re family","our group knows better"]
}

# A fallacy-specific diagnostic question for each entry. Local UI adds group questions too.
Q={
1:"Are you treating missing proof as proof of the opposite?",2:"Who made the factual claim, and what evidence did that person provide first?",3:"Is the requested proof realistically possible for a private intention, hypothetical, or 'never' claim?",4:"What reasons or evidence support the authority's opinion besides their status?",5:"Would the claim still be supported if nobody else agreed with it?",6:"How many examples are there, and are they representative of the larger set?",7:"Is a broad conclusion being drawn from too few cases?",8:"Was the pattern defined before the examples were selected, or after?",9:"What relevant evidence points the other way or was left out?",10:"What shows that A caused B rather than merely occurring before or alongside it?",11:"How often do the two events actually occur together compared with when they do not?",12:"What is the ordinary or baseline frequency of this event in comparable situations?",13:"Are vivid or easy-to-recall examples being mistaken for typical ones?",14:"Would you judge the original decision the same way if the outcome had turned out differently?",15:"Has repetition added new evidence, or only made the claim more familiar?",16:"What evidence is being offered besides confidence or repetition of the conclusion?",17:"What other plausible meanings could the silence or omission have?",18:"Do the two competing claims actually have equal evidentiary support?",19:"Even if the argument is flawed, what independent evidence bears on whether the conclusion is true?",
20:"Did the person state that thought or motive, or is it being inferred?",21:"What information is still missing before this conclusion can be firm?",22:"Does the alleged motive answer whether the person's actual claim is true?",23:"What evidence distinguishes deliberate action from accident, habit, stress, or misunderstanding?",24:"Is ambiguous behavior being interpreted in the most hostile available way?",25:"What evidence shows this event was caused by or centered on you?",26:"Could the feeling or motive being assigned to the other person actually be coming from your own state?",27:"If the exact same claim came from a different source, would you evaluate it differently?",28:"Is 'I cannot understand it' being used as evidence that it cannot be true?",29:"Was the thought, need, or intention actually communicated, or only assumed to be obvious?",30:"What context did the other person actually have at the time?",
31:"What is the emotion, and what separate external conclusion is being drawn from it?",32:"What reasons support the conclusion if the emotional pressure is removed?",33:"Are you deciding what is true based on what accepting it would emotionally mean?",34:"What concrete actions are hidden inside the abstract label?",35:"What realistic third option exists between the two extremes being offered?",36:"What is possible, what is probable, and what evidence makes the worst outcome inevitable?",37:"What specific behavior supports the identity label, and does it justify describing the whole person?",38:"Is this a mutual agreement, a value, a preference, or a private rule being treated as universal?",39:"What evidence would make this prediction more or less likely?",40:"Would your judgment change if the exact same behavior were described with neutral wording?",41:"What evidence shows other people noticed or judged this as much as you think they did?",
42:"Are recent events being allowed to represent a much longer time period?",43:"Have positive or neutral events been counted alongside the negative ones?",44:"What was actually knowable before the outcome occurred?",45:"Is an early label, number, or story still controlling the judgment despite newer evidence?",46:"Which details do you independently remember, and which came from later retellings?",47:"Are you remembering your past position as more consistent with your present position than records show?",48:"What difficulties from the 'better' past are being left out of the memory?",49:"Has the emotional intensity faded in a way that now makes the event seem less important than it was then?",50:"Is one positive trait being used as evidence for an unrelated judgment?",51:"Is one negative event or trait contaminating judgments about unrelated parts of the person?",
52:"What time period and actual frequency justify words like 'always' or 'never'?",53:"What evidence supports each step in the predicted chain rather than only the first and last?",54:"Does one part or one incident really justify a conclusion about the whole person, relationship, or system?",55:"Does a statement about the whole necessarily apply to every individual part or moment?",56:"What important differences between the two situations could make the analogy fail?",57:"Is the importance, frequency, or meaning of the negative event being inflated beyond the record?",58:"Is a meaningful event or impact being made smaller simply because it is inconvenient to address?",59:"What evidence shows that most reasonable people actually share this rule or assumption?",60:"Is a counterexample being excluded by redefining who counts as a 'real' member of the category?",
61:"Can the claim be answered without making a judgment about the person's character?",62:"What assumption is already built into the question before it is answered?",63:"Is the conclusion being used as the reason for believing the conclusion?",64:"What was the original strong claim, and has it been weakened only after challenge?",65:"Is the same key word being used with two different meanings in the argument?",66:"What was the original standard, and did it change after that standard was met?",67:"Does this new issue actually answer the question currently being discussed?",68:"Can the original criticism be answered before bringing up the other person's wrongdoing?",69:"Would the criticism still be valid even if the critic has done the same thing?",70:"Has the speaker been discredited in advance so that any response will be interpreted negatively?",71:"What argument remains after the mockery or sarcasm is removed?",72:"Is the practice being defended because it works, or merely because it is familiar and old?",73:"What evidence makes the newer approach better besides the fact that it is newer?",74:"Does being natural make the behavior good, justified, or obligatory?",75:"Can you restate the other person's position in a way they would recognize as accurate?",
76:"What relevant differences make the two situations equivalent or not equivalent?",77:"What principle justifies making an exception in this case, and would it apply to the other person too?",78:"Would you apply the same rule if the roles were reversed?",79:"Are all relevant contributions being examined, or only one person's?",80:"What situational pressures might explain the behavior before turning it into character?",81:"Are you explaining your own behavior by circumstances but the other person's by character?",82:"Are you using one causal standard for outcomes that flatter you and another for outcomes that do not?",83:"What alternatives existed, even if they were uncomfortable or difficult?",84:"If the past investment disappeared, what choice would make the most sense from today forward?",85:"Does a prior good deed or sacrifice actually create an exemption from the current rule?",86:"Are you assuming the outcome proves what the person deserved or morally caused?",87:"Is there a solution where both people's interests can be represented rather than one person having to lose?",88:"What consequences came from what was knowingly left undone, not just from overt actions?",89:"How much of the outcome was outside the person's control, and would you judge the same choice differently with different luck?",
90:"What is the strongest evidence against the conclusion you currently prefer?",91:"Has the original evidence changed while the belief remained untouched?",92:"Is corrective information being treated as another reason to become more certain?",93:"Are you assuming your own view is simply objective reality while disagreement proves bias or irrationality?",94:"What bias or reasoning trap might you be contributing to this same situation?",95:"Is there any possible response that could count against the accusation, or does every response prove it?",96:"What third, fourth, or mixed option exists beyond the two choices presented?",97:"What independent evidence supports the conclusion rather than restating it?",98:"Would you choose the current arrangement if you were deciding fresh today?",99:"Are you rejecting the idea because of its merits, or because being told what to do threatens autonomy?",100:"Would you give the same credibility to this claim if it came from someone outside your group?"
}

GROUP_CLARIFY={
"Evidence":["What exactly is the factual conclusion being claimed?","What evidence supports it, and what evidence would count against it?"],
"Intent":["What was actually observed, and what part describes a private thought or motive?","Did the person state the motive, or is it being inferred from behavior?"],
"Feeling → Fact":["What is the internal feeling, and what outside-world conclusion is attached to it?","Can the feeling be validated without automatically accepting the explanation for it?"],
"Memory":["Is there a contemporaneous record, or are we relying mainly on recall?","Could timing, retelling, emotion, or an earlier label be shaping the memory?"],
"Scale":["How large is the evidence set compared with the size of the conclusion?","What exceptions, denominators, or important differences have to be counted?"],
"Relevance":["What was the original question or claim?","Does this response answer it directly, or move to a different issue/person/definition?"],
"Fairness":["What rule is being applied, and would it survive a role reversal?","Are both people's relevant actions being judged by the same principle?"],
"Openness":["What specific evidence could lower confidence in this conclusion?","Is there a real path by which the belief could be revised?"],
}
GROUP_CHALLENGE={
"Evidence":"What evidence makes this conclusion more likely than the strongest alternative explanation?",
"Intent":"Can we separate what happened from what you think the person intended?",
"Feeling → Fact":"Can we honor the feeling while testing the factual conclusion separately?",
"Memory":"What does the best available record establish, and what remains memory or interpretation?",
"Scale":"Can we replace the absolute claim with a measured one using actual frequency and scope?",
"Relevance":"Can we answer the original question first and handle the second issue separately?",
"Fairness":"Would this exact standard still seem fair with the names reversed?",
"Openness":"What result would genuinely make you update this belief?",
}
GROUP_RESPONSES={
"Evidence":{
"curious":"What evidence are you using for that conclusion? I want to understand the step between what happened and what you're concluding.",
"direct":"I'm willing to address the claim, but I need the evidence for it before I try to disprove it.",
"deescalating":"I want to take the concern seriously. Can we first separate what we know from what we're assuming?"},
"Intent":{
"curious":"What made you think that was the intention?",
"direct":"You can describe what happened, but my motive shouldn't be stated as fact unless there's evidence for it.",
"deescalating":"I understand how the action may have landed. Can we separate the impact from what you think I intended?"},
"Feeling → Fact":{
"curious":"What feeling are you having, and what do you think that feeling tells you about what happened?",
"direct":"I accept that the feeling is real. I don't want the feeling alone to decide the external fact.",
"deescalating":"I believe you feel that way. Can we look separately at what happened and what the feeling seems to mean?"},
"Memory":{
"curious":"What do you remember directly, and is there any record we can compare it with?",
"direct":"Memory matters, but if a record exists I want us to use it before deciding what happened.",
"deescalating":"We may remember this differently. Let's use any record we have and mark the rest as uncertain rather than accusing each other."},
"Scale":{
"curious":"How often has this actually happened, over what period, and what exceptions are there?",
"direct":"That conclusion is broader than the examples so far. Let's make the scope match the evidence.",
"deescalating":"I hear that this feels like a pattern. Can we define the pattern precisely enough to test it?"},
"Relevance":{
"curious":"Can we finish the original question before moving to that other issue?",
"direct":"That may be worth discussing, but it doesn't answer the point we're on.",
"deescalating":"I will come back to that issue. First I'd like us to finish the one already on the table."},
"Fairness":{
"curious":"Would we use the same rule if our roles were reversed?",
"direct":"I want the same principle applied to both of us, with any relevant differences explained.",
"deescalating":"I don't need everything to be identical. I do want us to name the principle we're using for both sides."},
"Openness":{
"curious":"What evidence could realistically change your mind about this?",
"direct":"If no possible answer or evidence could count against the claim, I can't meaningfully test it.",
"deescalating":"I want to understand the concern. It would help me to know what information could genuinely update the conclusion."},
}

for f in data:
    i=f['id']
    f['keywords']=K[i]
    # Split longer, high-specificity signals from broad keywords for scoring.
    f['phrases']=[x for x in K[i] if ' ' in x and len(x)>=8]
    f['single_terms']=[x for x in K[i] if ' ' not in x]
    g=f['group']
    primary=Q[i]
    f['clarify_questions']=[primary, *GROUP_CLARIFY[g]][:3]
    f['challenge_questions']=[GROUP_CHALLENGE[g], f['better_move']]
    f['responses']=GROUP_RESPONSES[g]
    f['routing_note']='Keyword and phrase matches are routing signals only; qualifying answers determine whether the fallacy actually fits.'

p.write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n")
print('enriched',len(data),'fallacies')
print('with keywords',sum(bool(x.get('keywords')) for x in data))
print('with clarifiers',sum(bool(x.get('clarify_questions')) for x in data))
