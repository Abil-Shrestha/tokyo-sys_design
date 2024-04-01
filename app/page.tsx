import Image from "next/image";

import Fonts from "@/src/components/Fonts";

export default function Home() {
  return (
    <main className="flex flex-col justify-evenly h-screen text-white items-center  bg-gradient-to-bl from-[#dcdddd] via-[#797979] to-[#47585c]">
      <div className=" w-full h-screen flex flex-col items-center justify-center overflow-hidden rounded-md">
        <Fonts />
      </div>
    </main>
  );
}
