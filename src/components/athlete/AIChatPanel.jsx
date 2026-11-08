// import { useEffect, useRef, useState } from "react";
// import { Sparkles, SendHorizontal } from "lucide-react";
// import Card from "../ui/Card.jsx";
// import { Spinner } from "../ui/LoadingState.jsx";
// import { getAiChatThread, postAiChatMessage } from "../../api/mockApi.js";
// import "./AIChatPanel.css";

// const SUGGESTED_PROMPTS = [
//   "What drill do you recommend?",
//   "Why did my score change?",
//   "Is this fatigue or technique?",
// ];

// export default function AIChatPanel() {
//   const [messages, setMessages] = useState([]);
//   const [draft, setDraft] = useState("");
//   const [isThreadLoading, setIsThreadLoading] = useState(true);
//   const [isReplyPending, setIsReplyPending] = useState(false);
//   const scrollRef = useRef(null);

//   useEffect(() => {
//     getAiChatThread().then((thread) => {
//       setMessages(thread);
//       setIsThreadLoading(false);
//     });
//   }, []);

//   useEffect(() => {
//     scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
//   }, [messages, isReplyPending]);

//   function sendMessage(text) {
//     const trimmed = text.trim();
//     if (!trimmed || isReplyPending) return;

//     const userMessage = {
//       id: `m_${Date.now()}`,
//       from: "athlete",
//       text: trimmed,
//       ts: new Date().toISOString(),
//     };

//     setMessages((prev) => [...prev, userMessage]);
//     setDraft("");
//     setIsReplyPending(true);

//     postAiChatMessage(trimmed).then((reply) => {
//       setMessages((prev) => [...prev, reply]);
//       setIsReplyPending(false);
//     });
//   }

//   return (
//     <Card eyebrow="Ask about this session" title="AI coaching assistant" padded={false}>
//       <div className="ai-chat">
//         <div className="ai-chat__thread" ref={scrollRef}>
//           {isThreadLoading && (
//             <div className="ai-chat__loading">
//               <Spinner size={16} />
//             </div>
//           )}

//           {!isThreadLoading &&
//             messages.map((m) => (
//               <div key={m.id} className={`ai-chat__bubble ai-chat__bubble--${m.from}`}>
//                 {m.from === "ai" && <Sparkles size={13} className="ai-chat__ai-icon" />}
//                 <p>{m.text}</p>
//               </div>
//             ))}

//           {isReplyPending && (
//             <div className="ai-chat__bubble ai-chat__bubble--ai ai-chat__bubble--typing">
//               <Sparkles size={13} className="ai-chat__ai-icon" />
//               <span className="ai-chat__typing-dot" />
//               <span className="ai-chat__typing-dot" />
//               <span className="ai-chat__typing-dot" />
//             </div>
//           )}
//         </div>

//         {!isThreadLoading && messages.length < 2 && (
//           <div className="ai-chat__suggestions">
//             {SUGGESTED_PROMPTS.map((prompt) => (
//               <button key={prompt} onClick={() => sendMessage(prompt)}>
//                 {prompt}
//               </button>
//             ))}
//           </div>
//         )}

//         <form
//           className="ai-chat__composer"
//           onSubmit={(e) => {
//             e.preventDefault();
//             sendMessage(draft);
//           }}
//         >
//           <input
//             type="text"
//             value={draft}
//             placeholder="Ask a follow-up question…"
//             onChange={(e) => setDraft(e.target.value)}
//             disabled={isReplyPending}
//           />
//           <button type="submit" disabled={!draft.trim() || isReplyPending} aria-label="Send message">
//             <SendHorizontal size={16} />
//           </button>
//         </form>
//       </div>
//     </Card>
//   );
// }
import { useEffect, useRef, useState } from "react";
import { Sparkles, SendHorizontal } from "lucide-react";
import Card from "../ui/Card.jsx";
import { sendChatMessage } from "../../api/chatApi.js";
import "./AIChatPanel.css";

const SUGGESTED_PROMPTS = [
  "What drill do you recommend?",
  "Why is my score low?",
  "How can I improve my footwork?",
];

const GREETING = {
  id: "m1",
  from: "ai",
  text: "Hi! I'm your AI coaching assistant. Ask me anything about your batting, your analysis, or cricket in general.",
  ts: new Date().toISOString(),
};

export default function AIChatPanel({ analysis }) {
  const [messages, setMessages] = useState([GREETING]);
  const [draft, setDraft] = useState("");
  const [isReplyPending, setIsReplyPending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isReplyPending]);

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || isReplyPending) return;

    const userMessage = { id: `m_${Date.now()}`, from: "athlete", text: trimmed, ts: new Date().toISOString() };
    const oldMessages = messages; // history sent to the backend

    setMessages((prev) => [...prev, userMessage]);
    setDraft("");
    setIsReplyPending(true);

    let replyText;
    try {
      replyText = await sendChatMessage(trimmed, oldMessages, analysis);
    } catch (error) {
      replyText = error.message;
    }

    setMessages((prev) => [
      ...prev,
      { id: `m_${Date.now()}_ai`, from: "ai", text: replyText, ts: new Date().toISOString() },
    ]);
    setIsReplyPending(false);
  }

  return (
    <Card eyebrow="Ask about this session" title="AI coaching assistant" padded={false}>
      <div className="ai-chat">
        <div className="ai-chat__thread" ref={scrollRef}>
          {messages.map((m) => (
            <div key={m.id} className={`ai-chat__bubble ai-chat__bubble--${m.from}`}>
              {m.from === "ai" && <Sparkles size={13} className="ai-chat__ai-icon" />}
              <p>{m.text}</p>
            </div>
          ))}

          {isReplyPending && (
            <div className="ai-chat__bubble ai-chat__bubble--ai ai-chat__bubble--typing">
              <Sparkles size={13} className="ai-chat__ai-icon" />
              <span className="ai-chat__typing-dot" />
              <span className="ai-chat__typing-dot" />
              <span className="ai-chat__typing-dot" />
            </div>
          )}
        </div>

        {messages.length < 2 && (
          <div className="ai-chat__suggestions">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button key={prompt} onClick={() => sendMessage(prompt)}>{prompt}</button>
            ))}
          </div>
        )}

        <form
          className="ai-chat__composer"
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(draft);
          }}
        >
          <input
            type="text"
            value={draft}
            placeholder="Ask me anything…"
            onChange={(e) => setDraft(e.target.value)}
            disabled={isReplyPending}
          />
          <button type="submit" disabled={!draft.trim() || isReplyPending} aria-label="Send message">
            <SendHorizontal size={16} />
          </button>
        </form>
      </div>
    </Card>
  );
}