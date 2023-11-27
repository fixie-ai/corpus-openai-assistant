//-------------------------------------------//
// 0. Import Dependencies
//-------------------------------------------//
import OpenAI from 'openai';
import 'dotenv/config';
import { FixieClient } from "fixie";

//-------------------------------------------//
// 1. Initialize our Variables
//-------------------------------------------//
const OPENAI_MODEL = "gpt-4-1106-preview";
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
const fixieClient = new FixieClient({ apiKey: process.env.FIXIE_API_KEY });

const FIXIE_MAX_CHUNKS = 5;                                       // Max number of chunks to return from Fixie Corpus API.
const DEBUG_MESSAGES = false;                                      // Set to true to see debug messages.
const POLL_INTERVAL = 3000;                                       // Polling interval in milliseconds.
const FIXIE_CORPUS_ID = "437594d6-ae69-4e54-abea-c58ab2be80ec";   // Fixie.ai Corpus. This is a public corpus that anyone can query.

const ASSISTANT_NAME = "Fixie Assistant";
const SYSTEM_MESSAGE = "You are a helpful assistant who is an expert on a real company called Fixie.ai. The company is based in Seattle, WA and has a website at https://fixie.ai. Fixie provides a platform for helping developers build conversational, AI applications. You have access to a knowledge base that you can query for more information about Fixie, their products, and their APIs.";
const QUERY_FIXIE_CORPUS = {
  "name": "query_Fixie_Corpus",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "The query to execute against the knowledge base"
        }
      },
      "required": [
        "query"
      ]
    },
    "description": "Query a knowledge base of information about Matt Welsh."
};

const TOOLS = [{ "type": "function", "function": QUERY_FIXIE_CORPUS }];
const USER_MESSAGE = { role: "user", content: "What does Fixie.ai do?"};

//-------------------------------------------//
// 2. Function to call the Fixie Corpus API
//-------------------------------------------//
async function query_Fixie_Corpus(query) {
  if (DEBUG_MESSAGES) {
    console.log(`Calling Fixie Corpus API with query: ${query}`);
  }

  const queryResult = await fixieClient.queryCorpus({ corpusId: FIXIE_CORPUS_ID, query: query, maxChunks: FIXIE_MAX_CHUNKS });
  return queryResult;
}

//-------------------------------------------//
// 3. Create OpenAI Assistant and Dependencies
//-------------------------------------------//

// Create an Assistant
const assistant = await openai.beta.assistants.create({
  name: ASSISTANT_NAME,
  instructions: SYSTEM_MESSAGE,
  tools: TOOLS,
  model: OPENAI_MODEL
})

// Create a Thread
const thread = await openai.beta.threads.create()

// Add Messages to the Thread
const message = await openai.beta.threads.messages.create(thread.id, USER_MESSAGE);

// Create the Run Object Assistant Loop (Polling)
const run = await openai.beta.threads.runs.create(thread.id, {
  assistant_id: assistant.id
})

//-------------------------------------------//
// 4. Run the Assistant Loop (via Polling)
//-------------------------------------------//
async function runAssistant(interval) {
  const runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);  // get the run status
  if(DEBUG_MESSAGES) {
    console.log(`Run Status: ${runStatus.status}`);
  }

  // Check the run status
  switch (runStatus.status) {
    // Completed... display the messages
    case 'completed':
      const messages = await openai.beta.threads.messages.list(thread.id);  // get the messages
      messages.data.forEach((message) => {
        const role = message.role;
        const content = message.content[0].text.value;
        console.log(`\n${role}:\n${content}`);
      });
      break;

    // Requires Action... process the action and submit the tool outputs
    case 'requires_action':
      const tool_outputs = [];
      const requiredActions = runStatus.required_action.submit_tool_outputs;
      if(DEBUG_MESSAGES) {
        console.log(`\nAssistant requires action:\n${JSON.stringify(runStatus.required_action)}\n`);
        console.log(`\nRequired Actions:\n${JSON.stringify(requiredActions)}\n`);
      }

      // Make sure the closure is async or else we will send the tool outputs before they are all processed
      await Promise.all(requiredActions["tool_calls"].map(async (action) => {
        const functionName = action["function"]["name"];
        const functionArgs = action["function"]["arguments"];
        if(DEBUG_MESSAGES) {
          console.log(`\nFunction Name:\n${functionName}`);
          console.log(`\nArguments:\n${functionArgs}`);
        }

        // Make sure it's the right function for Fixie Corpus service
        if (functionName == "query_Fixie_Corpus") {
          const query = JSON.parse(functionArgs)["query"];
          const output = await query_Fixie_Corpus(query);
          tool_outputs.push({
            "tool_call_id": action["id"],
            "output": JSON.stringify(output)
          });
        } else {
          throw new Error(`Unknown function: ${functionName}`);
        }
      }));

      if(DEBUG_MESSAGES) {
        console.log("Submitting function output back to the Assistant...");
        console.log(`\nTool Outputs:\n${JSON.stringify(tool_outputs)}\n`);
      }
      
      openai.beta.threads.runs.submitToolOutputs(
        thread.id, 
        run.id, 
        {
          tool_outputs: tool_outputs
        }
      );
      setTimeout(() => runAssistant(interval), interval);
      break;
  
    // Still running... poll again
    default:
      console.log(`Assistant is still running. Polling again in ${interval}ms`);
      setTimeout(() => runAssistant(interval), interval);
      break;
  }
}

//-------------------------------------------//
// -- Start the Assistant Loop
//-------------------------------------------//
console.log(`\nStarting Assistant thread with message: ${JSON.stringify(USER_MESSAGE)}`);
runAssistant(POLL_INTERVAL);
